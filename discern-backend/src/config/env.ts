// Environment loading and validation. THE ONLY PLACE THAT READS process.env.
//
// CONVENTIONS.md §2. dotenv for the current working directory first, then
// backfill from the repository-root .env so a workspace command run from
// discern-backend/ still sees root config. Validation is Zod and it runs at
// IMPORT TIME, so a misconfigured process dies at boot rather than at the first
// request that happens to need the missing key.

import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

/** Minimum key material for HS256. 32 bytes is the hash's own output width. */
export const SECRET_MIN_BYTES = 32;

/**
 * Floor on distinct characters, because byte length alone cannot see entropy.
 *
 * "aaaa…a" (64 of them) is valid hex and decodes to a genuine 32 bytes, so a
 * pure length check passes it while the key has essentially no entropy. Any
 * randomly generated secret clears this comfortably — 64 random hex characters
 * use ~16 distinct symbols, 44 random base64 characters use ~30 — so the floor
 * only catches secrets that were typed rather than generated.
 */
export const SECRET_MIN_DISTINCT_CHARS = 8;

/**
 * How many bytes of key material a secret actually carries.
 *
 * Hex and base64 are checked before falling back to raw UTF-8, because both
 * encodings inflate the character count relative to the entropy they hold —
 * 64 hex characters and 44 base64 characters are both exactly 32 bytes.
 * Hex is tested first: its alphabet is a subset of base64's, so the order
 * matters or every hex secret would be measured as base64 and overcounted.
 */
export function secretByteLength(value: string): number {
  if (value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value)) {
    return value.length / 2;
  }

  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && value.length % 4 === 0) {
    return Buffer.from(value, "base64").length;
  }

  return Buffer.byteLength(value, "utf8");
}

/**
 * Byte-measured secret validation, reusable per key.
 *
 * A character count answers the wrong question. `openssl rand -base64 32` is
 * 44 characters carrying a full 256 bits, and a 64-character rule rejects it
 * while happily accepting 64 repeated 'a's. Pepta's 64-character bound was
 * really "32 bytes of hex" wearing a character count, so measuring bytes keeps
 * the same strength and stops punishing the stronger encoding.
 */
function strongSecret(name: string) {
  return z
    .string()
    .refine(
      (value) => secretByteLength(value) >= SECRET_MIN_BYTES,
      (value) => ({
        message:
          `${name} must carry at least ${SECRET_MIN_BYTES} bytes of key material ` +
          `(got ${secretByteLength(value)}). Generate one with: openssl rand -hex 32`,
      }),
    )
    .refine(
      (value) => new Set(value).size >= SECRET_MIN_DISTINCT_CHARS,
      (value) => ({
        message:
          `${name} has only ${new Set(value).size} distinct characters, which means it ` +
          "was typed rather than generated. Use: openssl rand -hex 32",
      }),
    );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  // "silent" is a real pino level and is what the test setup uses: a passing
  // suite should not print a request log for every supertest call.
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  /**
   * Injected by Render into every service. Absent locally.
   *
   * Surfaced in /healthz and in the worker's startup log so "is this running
   * what I just pushed" is one curl rather than an investigation. Corner's API
   * and worker drifted on 2026-08-28 — the worker ran current code while the web
   * service served a build two commits earlier, returning 501 from handlers that
   * had been implemented.
   */
  RENDER_GIT_COMMIT: z.string().optional(),
  RENDER_SERVICE_NAME: z.string().optional(),

  /**
   * Which process this is, for the logger's `service` base field.
   *
   * Render supplies RENDER_SERVICE_NAME and that wins. This exists for local
   * runs, where both entry points would otherwise log as "discern-api" and the
   * worker's output would be indistinguishable from the API's. Set by the
   * start:worker / dev:worker scripts.
   *
   * It has to be resolved HERE, at logger construction, rather than passed in
   * per call: pino child bindings are APPENDED to base, not merged over it, so
   * `logger.child({ service })` emits the key twice.
   */
  SERVICE_NAME: z.string().optional(),

  // Shape-checked here, not left to the driver.
  //
  // Mongoose's failure for a malformed URI is a MongoParseError stack trace that
  // names the connection-string parser rather than the variable, so the reader
  // has to already know what went wrong to read it. These checks name the actual
  // mistake instead. Whitespace is trimmed rather than reported — a trailing
  // newline from a copy-paste is never deliberate.
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required")
    .transform((value) => value.trim())
    .superRefine((value, ctx) => {
      const add = (message: string): void => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      };

      // The paste-the-whole-line mistake. Render takes key and value in
      // separate fields, so a .env line pasted into the value box lands here.
      const prefix = /^([A-Z_][A-Z0-9_]*)=/.exec(value);
      if (prefix) {
        add(
          `starts with "${prefix[1]}=" — the variable NAME was pasted into the ` +
            "value. Paste only the part after the '=' sign.",
        );
        return;
      }

      if (/^['"]|['"]$/.test(value)) {
        add(
          "is wrapped in quotes. Render stores the value literally, so the " +
            "quotes become part of the connection string. Remove them.",
        );
        return;
      }

      if (!/^mongodb(\+srv)?:\/\//.test(value)) {
        add(
          `does not start with "mongodb://" or "mongodb+srv://" (it starts ` +
            `with "${value.slice(0, 12)}..."). Copy the full string from ` +
            "Atlas > Connect > Drivers.",
        );
        return;
      }

      // Credentials are required for Atlas (mongodb+srv) but NOT for a local
      // mongod, which commonly runs without auth. Demanding them unconditionally
      // would reject the value .env.example ships as the local default —
      // mongodb://127.0.0.1:27017/discern — so local development could not boot.
      const hasCredentials = /^mongodb(\+srv)?:\/\/[^@/]+@/.test(value);
      const isSrv = value.startsWith("mongodb+srv://");

      if (isSrv && !hasCredentials) {
        add(
          "is an Atlas connection string with no username:password before the " +
            "'@'. Atlas's copied string contains a <db_password> placeholder " +
            "that must be replaced.",
        );
        return;
      }

      if (hasCredentials && !/^mongodb(\+srv)?:\/\/[^:@/]+:[^@]+@/.test(value)) {
        add("has an '@' but no username:password pair before it.");
        return;
      }

      if (/[<>]/.test(value)) {
        add(
          "still contains a < > placeholder from the Atlas example. Replace " +
            "it with the real password.",
        );
      }
    }),

  // The database Discern expects to be connected to, asserted at boot.
  //
  // ARCHITECTURE.md §4 puts `discern` on the EXISTING Atlas cluster, so "which
  // database did the URI actually resolve to" is not a rhetorical question. A
  // connection string with no path silently lands in `test`, and one copied from
  // a neighbouring service lands in THAT service's database — both look like a
  // clean startup and neither shows up until data is in the wrong place.
  // Enforced in db/connect.ts.
  MONGODB_DB_NAME: z.string().min(1).default("discern"),

  // Connection pool ceiling. Mongoose defaults to 100 per process; with an API
  // and a worker that is up to 200 sockets against a cluster that also serves a
  // shipped application. Discern has no load that needs them.
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // ---- Providers -----------------------------------------------------------
  //
  // WHY MOST OF THESE ARE OPTIONAL (Phase 2 amendment).
  //
  // Phase 1 required every provider key at boot. That is the right instinct and
  // the wrong mechanism: Phases 2-5 need none of them, so the only way to run the
  // corpus and journey work was to put PLACEHOLDER values in .env — and a
  // placeholder that satisfies a boot check is exactly how a real key never gets
  // set. The process starts, the check passes, and the failure moves to the first
  // request that actually calls the provider, which is the outcome the boot check
  // existed to prevent.
  //
  // So: optional here, VALIDATED WHENEVER PRESENT, and asserted at the owning
  // service on first use (see the assert* functions at the bottom of this file).
  // A key that is set is checked for shape immediately; a key that is absent
  // fails loudly at the boundary that needs it, naming the service.
  //
  // OPENAI_API_KEY stays required from Phase 3 onward in practice, and is kept
  // required here because embeddings are the first thing that touches a provider
  // and everything after Phase 3 depends on them.
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  /** Required from PHASE 7 (voice). Optional before that. */
  // REQUIRED FROM PHASE 7. The Phase 2 amendment made provider keys
  // optional-but-validated until the phase that uses them; this is that phase.
  // A service that boots without them would accept a voice conversation and
  // fail at the moment someone speaks.
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().min(1),
  /** Model for synthesis. Config, not a constant — quality/latency tiers move. */
  ELEVENLABS_TTS_MODEL: z.string().min(1).default("eleven_turbo_v2_5"),
  /** Model for transcription. */
  ELEVENLABS_STT_MODEL: z.string().min(1).default("scribe_v1"),

  // ---- Voice settings ------------------------------------------------------
  //
  // In config because `style` in particular is the dial that decides whether
  // she sounds dry and sardonic or like a meditation app, and that is a taste
  // judgement to be made by listening, not by deploying.
  ELEVENLABS_STABILITY: z.coerce.number().min(0).max(1).default(0.45),
  ELEVENLABS_SIMILARITY_BOOST: z.coerce.number().min(0).max(1).default(0.75),
  ELEVENLABS_STYLE: z.coerce.number().min(0).max(1).default(0.35),
  ELEVENLABS_SPEAKER_BOOST: z.enum(["true", "false"]).default("true")
    .transform((v) => v === "true"),

  // ---- THE SPEND CEILING ---------------------------------------------------
  //
  // Built before the feature, deliberately. ElevenLabs is the only cost that
  // scales with one user's enthusiasm, and the failure it guards against is not
  // a busy subscriber — it is a retry loop against a per-character API.
  //
  // DEFAULTS TIGHTENED AFTER MEASURING. The first pass allowed 60,000
  // characters per user per day, which at the configured rate is $18.00 — the
  // entire annual revenue from that subscriber in 1.6 days.
  //
  // Measured: a reply is ~1,431 speakable characters, so a spoken reply costs
  // about $0.43 against $0.018 for the same turn in text. 12,000 characters is
  // roughly eight spoken replies a day, which is more than a real person has
  // and still $3.60 — so this is a RUNAWAY GUARD, not an economic fix. The
  // economics need a cheaper rate or a smaller unit of speech; see the Phase 7
  // report. A ceiling cannot make a 24x cost multiplier work.
  TTS_DAILY_CHARS_PER_USER: z.coerce.number().int().positive().default(12_000),
  TTS_DAILY_CHARS_GLOBAL: z.coerce.number().int().positive().default(300_000),
  STT_DAILY_SECONDS_PER_USER: z.coerce.number().int().positive().default(1_800),
  STT_DAILY_SECONDS_GLOBAL: z.coerce.number().int().positive().default(72_000),
  /** Longest single synthesis. A runaway reply must not be one huge bill. */
  TTS_MAX_CHARS_PER_REQUEST: z.coerce.number().int().positive().default(5_000),

  // Published rates, for reporting only. Nothing bills off these.
  TTS_USD_PER_1K_CHARS: z.coerce.number().nonnegative().default(0.30),
  STT_USD_PER_MINUTE: z.coerce.number().nonnegative().default(0.006),

  // Model IDs are CONFIG, not constants (CONVENTIONS.md §2). Declared optional
  // here because config/models.ts owns the DEFAULTS and the documentation of
  // what each tier is for; this file only carries the override. Setting one of
  // these swaps a model with no code change.
  SAFETY_MODEL: z.string().optional(),
  PREMISE_MODEL: z.string().optional(),
  CONVERSATION_MODEL: z.string().optional(),
  REASONING_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  HYDE_MODEL: z.string().optional(),

  // ---- Reasoning effort per tier -------------------------------------------
  //
  // Unset everywhere until 2026-09-02, so every call ran at the API default and
  // paid for an extended reasoning chain whether or not the job needed one.
  // Overridable so a quality regression can be reverted from the dashboard.
  SAFETY_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  PREMISE_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  CONVERSATION_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  HYDE_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),

  // ---- Object storage: S3, bucket discern-audio (PHASE 7) ------------------
  // Mongo stores the S3 key only, never the blob (ARCHITECTURE.md §4).
  //
  // Validated when present, asserted by the speech service on first use.
  AWS_REGION: z
    .string()
    .min(1)
    .refine(
      (value) => value !== "auto",
      "AWS_REGION must be a REAL AWS region. \"auto\" is a Cloudflare R2 " +
        "convention that the AWS SDK rejects at request time, not at config time.",
    )
    .refine(
      (value) => /^[a-z]{2}(-[a-z]+)+-\d$/.test(value),
      (value) => ({
        message:
          `AWS_REGION "${value}" is not an AWS region identifier ` +
          "(expected a form like us-east-2 or eu-west-1).",
      }),
    )
    .optional(),
  // REQUIRED FROM PHASE 7: synthesized audio lives in S3, never in Mongo.
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  // S3 bucket naming rules, checked here rather than at first upload: 3-63
  // characters, lowercase letters/digits/hyphens/dots, must start and end
  // alphanumeric. An invalid name fails every request with an opaque SDK error.
  S3_BUCKET: z
    .string()
    .refine(
      (value) =>
        value.length >= 3 &&
        value.length <= 63 &&
        /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value),
      (value) => ({
        message:
          `S3_BUCKET "${value}" is not a valid bucket name (3-63 chars, ` +
          "lowercase letters, digits, hyphens and dots, starting and ending " +
          "alphanumeric).",
      }),
    ),

  // ---- RevenueCat: REQUIRED FROM PHASE 4 -----------------------------------
  // Shared secret, timing-safe compared at the webhook. NOT byte-validated: the
  // value is issued by RevenueCat, so its format is theirs to choose and a
  // strength floor here could reject a legitimate secret.
  //
  // Required at boot from this phase, per the Phase 2 env amendment. The webhook
  // FAILS CLOSED without it (503, never "assume free"), and a service that
  // silently accepts unverified billing callbacks is worse than one that will
  // not start.
  REVENUECAT_WEBHOOK_SECRET: z.string().min(1, "REVENUECAT_WEBHOOK_SECRET is required"),
  REVENUECAT_SECRET_API_KEY: z.string().min(1).optional(),

  // ---- Auth: REQUIRED FROM PHASE 4 -----------------------------------------
  // Phase 4 issues tokens, so the secret is now load-bearing. Byte-measured, not
  // character-counted (see secretByteLength).
  JWT_SECRET: strongSecret("JWT_SECRET"),
  JWT_EXPIRES_IN: z.string().default("30d"),

  // FREE_CONVERSATION_ALLOWANCE was removed on 2026-09-01 with the free tier.
  // There is no allowance to configure — entitlement is the only gate.

  /**
   * Soft cap on ACTIVE carryings.
   *
   * A product rule, not a technical limit — and the thesis of the app. You
   * cannot dwell on ten things, and an unbounded list turns carryings into a
   * reading queue, which is the exact thing Discern exists not to be. Adding
   * past the cap prompts the user to release something first; it never silently
   * evicts, and released carryings are kept forever.
   *
   * Config rather than a constant so it can be moved after watching real use.
   */
  ACTIVE_CARRYING_CAP: z.coerce.number().int().positive().default(3),

  /**
   * Serves the THROWAWAY test client at GET /test. Default OFF.
   *
   * The page is a plain HTML conversation with Abigail, handed to a handful of
   * real people on their own phones before any native app exists. Serving it
   * from this process is what makes that link work from anywhere and removes
   * the cross-origin problem entirely — the page and the API are one origin.
   *
   * It is a flag rather than a NODE_ENV check because it has to be ON in a
   * deployed environment (a link to localhost is useless to someone else's
   * phone) and OFF everywhere else. Turn it off when testing ends, and delete
   * the route and public/abigail-test.html with it.
   */
  TEST_CLIENT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Bundle id of the iOS app, used as the `aud` claim when verifying a Sign in
   * with Apple identity token.
   *
   * Optional here and REQUIRED AT USE: linking refuses to run without it rather
   * than verifying a token with no audience check, because a real Apple token
   * issued to any other app would otherwise be accepted as an identity here.
   * See services/users/identity-verification.ts.
   */
  APPLE_BUNDLE_ID: z.string().min(1).optional(),

  /**
   * Directory holding Abigail's prompt files, which are NOT in the repository.
   *
   * Unset is normal: config/prompts.ts then looks in ./prompts relative to the
   * working directory and to its parent, which covers running from the repo
   * root and from discern-backend/. Set it when the files are mounted somewhere
   * else — a Render Secret File path, a container volume.
   */
  PROMPTS_DIR: z.string().min(1).optional(),

  // ---- Worker tuning (Phase 8) ---------------------------------------------
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

/**
 * An empty value means "not set", not "set to nothing".
 *
 * `.env` files describe optional keys by leaving them blank — `.env.example`
 * ships exactly that for every provider key — and dotenv loads a blank line as
 * the empty STRING, not as undefined. Without this, `z.string().min(1).optional()`
 * sees "" (present, and too short) and refuses to boot on a key that was
 * deliberately left unset. The repo's own example file would fail this way.
 *
 * Dropping empty values before validation is what makes "optional" mean what it
 * looks like it means.
 */
const presentEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && value !== "") presentEnv[key] = value;
}

const parsed = envSchema.safeParse(presentEnv);

if (!parsed.success) {
  // Separate "you never set this" from "you set it to something invalid".
  // They have completely different fixes, and a flat list of Zod messages makes
  // a too-short secret look identical to a missing one.
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "(root)";
    const absent = presentEnv[key] === undefined;
    (absent ? missing : invalid).push(
      absent ? `  ${key}` : `  ${key}: ${issue.message}`,
    );
  }

  const lines = ["Invalid environment configuration.", ""];

  if (missing.length > 0) {
    lines.push("NOT SET:", ...missing, "");
  }
  if (invalid.length > 0) {
    lines.push("SET BUT INVALID:", ...invalid, "");
  }

  lines.push(
    "Where these come from:",
    "  - Local:  copy .env.example to .env at the repo root and fill it in.",
    "  - Render: Dashboard > Env Groups > 'discern-secrets'. Values are declared",
    "            `sync: false` in render.yaml, which means Render never supplies",
    "            them — you set them once and both services inherit the group.",
    "",
    `  Secrets must carry at least ${SECRET_MIN_BYTES} bytes of key material.`,
    "  Generate one with:  openssl rand -hex 32",
    "  (hex and base64 secrets are measured after decoding, so both",
    "  `openssl rand -hex 32` and `openssl rand -base64 32` are accepted.)",
  );

  throw new Error(lines.join("\n"));
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

// ---------------------------------------------------------------------------
// Service-boundary assertions.
//
// These replace the Phase 1 boot checks for keys that only some phases need.
// Each is called by its owning service the first time it does real work, so an
// absent key fails at the boundary that needs it, naming the service and the
// phase, instead of either (a) blocking a phase that does not need it or
// (b) surfacing as an opaque 401 from a provider.
//
// Call these at construction or first use, NOT per request.
// ---------------------------------------------------------------------------

function missing(service: string, keys: string[], phase: string): Error {
  return new Error(
    [
      `${service} is not configured.`,
      "",
      "NOT SET:",
      ...keys.map((key) => `  ${key}`),
      "",
      `  These become required in ${phase}. Set them locally in the repo-root`,
      "  .env, or on Render in Env Groups > 'discern-secrets'.",
    ].join("\n"),
  );
}

// Each returns the narrowed configuration rather than asserting on the module
// const: TypeScript's `asserts x is T` only narrows a PARAMETER, so a call site
// would still see the optional types. Returning the values means the caller gets
// non-optional strings and cannot accidentally read an unchecked key.

/** Phase 7. Called by services/speech before its first synthesis. */
export function requireElevenLabs(): { apiKey: string; voiceId: string } {
  const absent = (["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"] as const).filter(
    (key) => !env[key],
  );

  if (absent.length > 0 || !env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
    throw missing("ElevenLabs text-to-speech", [...absent], "Phase 7 (voice)");
  }

  return { apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID };
}

/** Phase 7. Called by services/speech before its first upload. */
export function requireS3(): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
} {
  const absent = (
    [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
      "S3_BUCKET",
    ] as const
  ).filter((key) => !env[key]);

  if (
    absent.length > 0 ||
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.AWS_REGION ||
    !env.S3_BUCKET
  ) {
    throw missing("S3 audio storage", [...absent], "Phase 7 (voice)");
  }

  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
  };
}

/** Phase 4. Called by the RevenueCat webhook route before verifying a signature. */
export function requireRevenueCatWebhookSecret(): string {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    throw missing(
      "RevenueCat billing",
      ["REVENUECAT_WEBHOOK_SECRET"],
      "Phase 4 (entitlements)",
    );
  }

  return env.REVENUECAT_WEBHOOK_SECRET;
}
