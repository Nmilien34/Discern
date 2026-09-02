# Discern Conventions

Extracted from the two authoritative reference repos on 2026-08-31, at the Phase 0 gate.
Nothing here is invented for its own sake: every rule below is something Pepta or Corner
already does in shipped source, or a deliberate, marked departure required by
`ARCHITECTURE.md`.

## Sources and how disagreements were settled

| Repo | Role | Path |
|---|---|---|
| Pepta | Authoritative for conventions | `/Users/roadto1million/Developer/Pepta` |
| Corner | Most recent Node/Express/Mongo/Render backend | `Repos/BoltzmanLab/Corner-app` |

Corner-app was **located by search**, not by the path in `ARCHITECTURE.md` §2 — it is at
`Repos/BoltzmanLab/Corner-app`, not under `~/Desktop/Programing/`. The stale Pepta copy in
the masters folder (`Pepta-stale-unuse`) was not read.

Two ordering rules were used:

1. **Shipped source beats prose.** Corner's own `CONVENTIONS.md` is a Phase 0 reconnaissance
   document written *before* Corner had code. Where that document and the current
   `corner-backend/src` tree disagree, the tree wins. (Its own audit applies the same rule to
   Leanient's `AGENTS.md`, which describes a `controllers/` folder that no source tree has.)
2. **Corner beats Pepta where Corner is a deliberate correction.** Corner is newer and several
   of its patterns are documented fixes to problems Pepta hit in production. Those are marked
   `[CORNER-HARDENED]` below and are adopted for Discern.

Markers: `[ADOPTED]` — both repos agree, or Corner supersedes. `[CORNER-HARDENED]` — Corner
fixed a real incident; carry the fix, not the original. `[DISCERN]` — required by
`ARCHITECTURE.md` and not present in either reference; these are the ones to review.

---

## 1. Folder and file naming

Both backends use the same `src/` tree. Pepta: `app.ts`, `index.ts`, `auth/`, `config/`,
`db/`, `jobs/`, `lib/`, `middleware/`, `models/`, `routes/`, `scripts/`, `seeds/`,
`services/`, `tests/`, `types/`. Corner is identical minus `seeds/`, plus `prompts/`.

`[ADOPTED]`

- **kebab-case** for backend filenames: `async-handler.ts`, `request-logger.middleware.ts`,
  `model-utils.ts`. Not camelCase (Leanient's style, not carried forward).
- **Suffixes carry the role**: `.model.ts`, `.routes.ts`, `.middleware.ts`, `.service.ts`.
- **PascalCase** for frontend components and screens only.
- **No `controllers/` directory.** Neither live source tree has one. Handlers live inline in
  route modules and delegate to services.
- `lib/` is for cross-cutting primitives with no domain knowledge (`errors.ts`, `logger.ts`,
  `responses.ts`, `async-handler.ts`). Domain logic goes in `services/`.

`[DISCERN]` `ARCHITECTURE.md` §3 nests services by domain
(`services/abigail/`, `corpus/`, `journey/`, `safety/`, `speech/`, `billing/`). Neither
reference subdivides `services/`. Adopted as specified — Discern has six genuinely separate
domains and a flat directory would not survive Phase 6.

`[ADOPTED]` **A `shared/` workspace**, matching both references. Root npm workspaces are
`shared` and `discern-backend`; the frontend joins in Phase 9. Zod request/response contracts
live in `@discern/shared` and are imported by both the backend and, later, the app. Provider-
private payload schemas may stay next to their adapter if they are never a client contract.

> Resolved by **Amendment A** at the Phase 1 gate, reversing `ARCHITECTURE.md` §3's original
> two-workspace layout. Flagged at Phase 0 because adding it after schemas exist means moving
> every one of them; taken before Phase 2 wrote the first model, which was the cheap moment.

---

## 2. Config and env loading

`[ADOPTED]` `src/config/env.ts`, and nothing else reads `process.env`.

```ts
dotenv.config();                                              // CWD first
dotenv.config({ path: path.resolve(process.cwd(), "../.env") }); // then repo root
```

The root backfill is what lets a workspace command run from `discern-backend/` still see root
config. Validation is a Zod schema parsed **at import time**, so a misconfigured process dies
at boot rather than at the first request that happens to need the missing key.

`[ADOPTED]` One tracked root `.env.example` is the **complete canonical inventory** — every
`process.env` key read anywhere must appear there with a placeholder and a one-line comment.
Local `.env` is ignored. Expo public keys are prefixed `EXPO_PUBLIC_`; server-only keys never
are.

`[CORNER-HARDENED]` Three things Corner's `env.ts` does that are worth copying verbatim:

- **Split "not set" from "set but invalid"** in the startup error. They have completely
  different fixes, and a flat list of Zod messages makes a too-short secret look identical to
  a missing one. The error also names where the value comes from (local `.env` vs the Render
  env group).
- **Shape-check `MONGODB_URI` in Zod, not in the driver.** Mongoose's failure for a malformed
  URI is a `MongoParseError` stack trace naming the connection-string parser, not the
  variable. Corner catches the real mistakes by name: the variable name pasted into the value
  box, wrapping quotes, a missing `mongodb://` scheme, an unreplaced `<db_password>`
  placeholder. Credentials are required for `mongodb+srv` but **not** for a local `mongod`,
  which commonly runs without auth.
- **Measure secrets in bytes after decoding, not characters.** `secretByteLength()` tries hex,
  then base64, then raw UTF-8 — hex first, because its alphabet is a subset of base64's and
  the order matters. Plus a floor of 8 distinct characters, because 64 repeated `a`s are valid
  hex that decode to a genuine 32 bytes and a length check alone accepts them.

`[DISCERN]` **Model IDs are config values, not constants** — `src/config/models.ts`, with env
overrides, per the Phase 1 prompt. Neither reference has this; both hardcode provider model
names at the call site. Discern routes across four model tiers (`ARCHITECTURE.md` §7) and
needs to swap any of them without a code change.

`[CORNER-HARDENED]` **Provider keys are optional-but-validated, asserted at the owning
service.** *(Amendment C, Phase 2 gate.)*

Phase 1 required every provider key at boot. Right instinct, wrong mechanism: Phases 2-5 need
none of them, so the only way to run the corpus and journey work was to put **placeholder
values** in `.env` — and a placeholder that satisfies a boot check is exactly how a real key
never gets set. The process starts, the check passes, and the failure relocates to the first
request that actually calls the provider, which is the outcome the boot check existed to
prevent.

So each key is optional in the schema, **validated whenever present**, and asserted at its
owning service by `requireElevenLabs()` / `requireS3()` / `requireRevenueCatWebhookSecret()`.
These return the narrowed config rather than using `asserts x is T`, which only narrows a
*parameter* and would leave the call site reading optional types. `MONGODB_URI` and
`OPENAI_API_KEY` stay required at boot. `.env.example` states which phase makes each one
required: RevenueCat at Phase 4, ElevenLabs and S3 at Phase 7.

Validation-when-present is not a formality — it catches the two mistakes that produce opaque
runtime errors: `AWS_REGION=auto` (a Cloudflare R2 convention the AWS SDK rejects at request
time) and a bucket name that violates S3's naming rules.

---

## 3. Error handling and response shape

`[ADOPTED]` The envelope is exact and non-negotiable:

```
success  { "data": ... }
failure  { "error": { "code": "...", "message": "...", "details"?: ... } }
```

`lib/responses.ts` — `sendData(res, value, statusCode = 200)`, `sendNoContent(res)` (204),
and `sendNotImplemented(res, todo)` (501, a real response in the standard envelope, not a
crash and not a 404).

`lib/errors.ts` — `AppError` carries `code`, `statusCode`, `details?`, and an **`expose`**
flag deciding whether the message is safe to send to a client. Subclasses:
`ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403),
`NotFoundError` (404), `ConflictError` (409), `RateLimitedError` (429),
`InternalError` (500, `expose: false`), `NotImplementedError` (501).

`middleware/error.middleware.ts` — `notFoundHandler` turns unmatched routes into the standard
envelope. `errorHandler` wraps any non-`AppError` as a non-exposed 500, logs `≥500` at `error`
and the rest at `warn` with `{ requestId, code, status, path }`, and sends the generic
`"Internal server error"` for unexposed errors so the real message stays in the log,
correlated by request ID.

`lib/async-handler.ts` — `asyncHandler` forwards rejected promises to the error middleware.
Express 5 does this on its own; it stays explicit so handler signatures are uniform and the
two backends read the same way.

`[CORNER-HARDENED]` Corner adds status codes worth keeping for Discern:

- **402 `payment_required`** rather than 403, so the app can distinguish "buy this" from
  "you may never have this" and render a paywall. *(`quota_exceeded` was deleted on
  2026-09-01 with the free tier — `ARCHITECTURE.md` §10 decision 3 was corrected to a hard
  paywall behind a 7-day trial, so there is no quota and 402 is the only paywall response.)*
- **503 `access_unavailable`** — access could not be *verified* right now, distinct from a
  positive "no". A provider outage must never downgrade a paying user to inactive; 503 tells
  the client to retry where a 402 would send them to a paywall they already paid at.
- **502 `reasoning_budget_exhausted`** — a reasoning model that spends its whole
  `max_completion_tokens` on reasoning returns `finish_reason: "length"` with **empty content
  and no error**: a 200 carrying nothing. Corner names it because the symptom points nowhere
  near the cause. **Discern will hit this harder than Corner did** — the Phase 6 reasoning
  turn carries retrieved passages, memory, and premise output into a long prompt, and every
  structured call is exposed. Port this class in Phase 1.

---

## 4. Logging

`[ADOPTED]` Pino, structured JSON, ISO timestamps, `service` base field:

```ts
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "discern-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

`middleware/request-logger.middleware.ts` accepts an inbound `x-request-id` (bounded to 200
chars) or mints a `randomUUID()`, echoes it on the response, and logs
`{ requestId, method, path, status, durationMs }` on `res.finish`. Duration is measured with
`process.hrtime.bigint()`, rounded to 2 decimals.

Use `logger.child({ ... })` for per-job and per-turn context — Corner's worker does this per
job, and Discern should do it per Abigail turn so the pipeline's stages share a correlation
ID.

`[CORNER-HARDENED]` **Report the running commit.** Corner's `lib/build-info.ts` surfaces
`RENDER_GIT_COMMIT` and `RENDER_SERVICE_NAME` in `/healthz` and in the worker's startup log.
This exists because on 2026-08-28 the API and worker drifted — the worker ran current code
while the web service served a build two commits earlier, returning 501 from handlers that
had been implemented. Three separate times in one day something looked healthy while not
being current. Carry this into Phase 1; it costs ten lines and it turns a diagnosis into one
curl.

---

## 5. Express route and controller structure

`[ADOPTED]` **Split the app factory from the process entry.**

`src/app.ts` exports `createApp(): Express` so tests can build an app without binding a port
or starting schedulers. Middleware order, exactly as Corner mounts it:

```
disable("x-powered-by") → helmet() → cors() → express.json({ limit }) →
requestLogger → Cache-Control: no-store → health (unversioned) →
/v1 router → notFoundHandler → errorHandler
```

`src/index.ts` is the process entry: assert external preconditions, connect Mongo,
`createApp()`, listen, and handle `SIGINT`/`SIGTERM` by closing the server, disconnecting
Mongo, then exiting — with a `setTimeout(..., 10_000).unref()` hard cap so a hung connection
cannot hold the process past Render's shutdown window. Guarded by `require.main === module`.

`[ADOPTED]` Route modules are thin: `Router()`, validation middleware, `asyncHandler`,
`sendData`. Business behavior lives in services. Document-scoped sub-resources mount as
separate routers (`v1.use("/documents/:id", documentChatRouter)`) so each concern keeps its
own file instead of one router accumulating every feature — Discern should do the same for
`/v1/abigail/conversations/:id`.

`[ADOPTED]` **Health is unversioned**, product API is under `/v1`. Render's health check is
infrastructure and does not move with the product API. Note the two references mount
unversioned product routes; `/v1` comes from Corner and is what `ARCHITECTURE.md` §9
specifies.

`[ADOPTED]` The health route is **`/healthz`**, matching Corner and Leanient, and
`render.yaml` sets `healthCheckPath: /healthz`. Resolved by **Amendment B** at the Phase 1
gate; `ARCHITECTURE.md` §9 now names it explicitly.

`[ADOPTED]` Validation via `validateBody` / `validateQuery` / `validateParams`, all using
`safeParse` and reporting structured `{ path, message }` details through `ValidationError`.
Express 5 makes `req.query` a read-only getter, so the parsed value must be redefined with
`Object.defineProperty`, not assigned — both references hit this.

---

## 6. Mongoose model style

`[ADOPTED]`

- Export an `XDocument extends Document<Types.ObjectId>` interface, then
  `new Schema<XDocument>(...)`.
- `mongoose.model<XDocument>("Passage", passageSchema)` — **PascalCase singular**; Mongoose
  derives the plural collection name.
- `{ timestamps: true, versionKey: false }` on every top-level schema.
- `{ _id: false }` on embedded value-object schemas.
- References are `Schema.Types.ObjectId` with a singular PascalCase `ref`.
- **Declare compound and partial unique indexes explicitly** with `schema.index(...)`, next
  to the schema that owns them. Corner's `user.model.ts` is the reference for partial unique
  indexes (`partialFilterExpression`) when a field is unique only when present.
- `applyApiTransforms(schema, omit?)` from `models/model-utils.ts`: `_id` → `id`, drops
  `__v`, serializes `Date` → ISO string and `ObjectId` → string, recursively.

`[CORNER-HARDENED]` **The `omit` list belongs on the model, not the call site.** Response
schemas are strict — they reject unknown keys rather than ignoring them — so a persistence
field that is not part of the contract does not get quietly dropped, it throws. Pepta lost
`/home`'s entire profile section in production on 2026-08-21 to exactly this, via a field
declared `default: null` and therefore present on every document. Corner declares the omission
on the model so a new serialization call site inherits it.

**Discern's exposure is the same shape and worse in degree.** `passages.embedding` and
`hymns.embedding` are multi-hundred-float arrays on the hottest read path in the app
(`ARCHITECTURE.md` §6). Every passage-returning endpoint and every Abigail tool result
touches them. Declare `applyApiTransforms(passageSchema, ["embedding"])` when the model is
written in Phase 2 — not when someone notices the payload size in Phase 6.

`[CORNER-HARDENED]` **Do not default a `required: true` string to `""`.** Mongoose's
`required` tests truthiness, not presence, so `required: true` with `default: ""` makes the
subdocument unconstructable and `create()` throws on every insert. Corner hit this on
anonymous signup; its period keys default to the current period via `default: () => monthKey()`.
Relevant to Discern's `userStage` and `carryings` defaults.

`[DISCERN]` **Do not reach for soft-delete on the corpus or on `seedEvents`.**
`applySoftDeleteQueryMiddleware` exists in both references and is right for `users`. But
`seedEvents` is an append-only ledger (`ARCHITECTURE.md` §6): nothing deletes from it, softly
or otherwise, and a `pre(/^find/)` hook that silently filters rows would corrupt the derived
seed state for anyone whose history it touched. Seed state is computed, never stored.

---

## 7. Mongo connection

`[ADOPTED]` `src/db/connect.ts` exports three functions and owns the whole lifecycle:

```ts
connectToDatabase(): Promise<void>       // mongoose.set("strictQuery", true) first
disconnectFromDatabase(): Promise<void>
isDatabaseReachable(): boolean           // readyState === 1, backs GET /health
```

Reuse is Mongoose's own connection pool — a single `mongoose.connect()` at process start, no
per-request connections, no custom client cache. `maxPoolSize` comes from
`MONGODB_MAX_POOL_SIZE` (default 10), and `serverSelectionTimeoutMS: 10_000`.

`[CORNER-HARDENED]` **Assert the database name after connecting, and refuse to start if it is
wrong.** This is the single most important thing to carry over, and it applies to Discern
verbatim: `ARCHITECTURE.md` §4 puts the `discern` database on **the existing cluster**, the
same situation that produced Corner's rule.

Two ordinary mistakes put collections somewhere they must never appear, and neither produces
an error on its own:

```
mongodb+srv://.../?retryWrites=true    → silently connects to `test`
mongodb+srv://.../corner?...           → connects to the neighbour's database
```

Both log a clean "mongo connected" and serve traffic happily. The damage is only visible
later, in the wrong collection, on a cluster with real users on it. Corner disconnects and
throws with an error that names the expected and actual database and tells you which of the
two mistakes you made.

`[ADOPTED]` **Pool the worker lower than the API.** Mongoose defaults to 100 sockets per
process; an API plus a worker is up to 200 against a cluster that also serves production
traffic. Corner sets `MONGODB_MAX_POOL_SIZE=5` on the worker specifically.

`[DISCERN]` Index creation on boot is required by the Phase 1 prompt. Both references rely on
Mongoose's `autoIndex`, which is fine for Phase 1, but note that Atlas **Vector Search indexes
are not Mongoose indexes** — they are created through the Atlas API/CLI and must be committed
as JSON under `src/db/search-indexes/` (Phase 3). Corner's `scripts/create-vector-index.ts`
and `jobs/vector-index-check.ts` are the precedent: the worker **warns rather than crashes**
when the vector index is missing, because most of the app works without it.

---

## 8. TypeScript and package setup

`[ADOPTED]` Root `tsconfig.base.json`, extended by each workspace:

```json
{
  "target": "ES2022",
  "module": "CommonJS",
  "moduleResolution": "Node",
  "strict": true,
  "esModuleInterop": true,
  "forceConsistentCasingInFileNames": true,
  "skipLibCheck": true,
  "resolveJsonModule": true,
  "isolatedModules": false,
  "noImplicitOverride": true,
  "noUncheckedIndexedAccess": true
}
```

Backend `tsconfig.json` adds `outDir: "dist"`, `rootDir: "src"`,
`types: ["node", "vitest/globals"]`, `sourceMap: true`, `include: ["src/**/*.ts"]`.

`[ADOPTED]` CommonJS output; **no `"type": "module"`**. Process entries use
`require.main === module`.

`[ADOPTED]` Runtime baseline: **Node ≥20** in `engines` (`.node-version` pins 22), TypeScript
5.9, Express 5.1, Mongoose ^8.24.4, Zod ^3.25, Pino ^9.6, `tsx` for dev/scripts, Vitest 3 +
Supertest 7 for tests.

`[ADOPTED]` Root is an npm workspace root with `build`, `lint`, `typecheck`, `test`, `format`
scripts fanning out via `-ws --if-present`. Backend scripts: `dev` (`tsx watch src/index.ts`),
`dev:worker`, `build` (`tsc -p tsconfig.json`), `start` (`node dist/index.js`),
`start:worker` (`node dist/worker/index.js`), `typecheck`, `lint`, `test`.

`[ADOPTED]` Tests live in `src/tests/**/*.test.ts`, Node environment, with a setup file that
strips developer-local provider secrets so a test run can never call a live provider. Discern
needs this more than either reference: its tests sit next to OpenAI and ElevenLabs keys, and
ElevenLabs is billed per character.

---

## 9. Render configuration

`[ADOPTED]` One root `render.yaml` defining both services from one repo. Leanient's manifest
is the shape; Corner's two-service version is the direct precedent for Discern's
`discern-api` + `discern-worker`.

```yaml
buildCommand: npm install --include=dev && npm run build -w @discern/backend
startCommand: npm run start -w @discern/backend          # worker: start:worker
```

`--include=dev` is required: the build compiles TypeScript, so `devDependencies` must install
even under `NODE_ENV=production`. Runtime only needs `dist/`.

`[CORNER-HARDENED]` **One `envVarGroups` group is authoritative; do not duplicate its keys
per service.** A per-service entry *overrides* the group, which reintroduces exactly the drift
the group exists to prevent. The API and the worker must agree on the database, the bucket,
and the secrets — declared separately they are two dashboard forms that can diverge, and a
worker pointed at a different database than the API is a genuinely nasty failure: the queue
looks empty and jobs never run.

- Shared secrets → `fromGroup: discern-secrets`, each declared `sync: false` (Render never
  invents the value; a human sets it once and both services inherit it).
- Non-secret per-service values (`NODE_ENV`, `LOG_LEVEL`, worker tuning, pool size) stay
  inline, because they legitimately differ per service.

`[ADOPTED]` The web service sets `healthCheckPath`; the worker sets none and binds no port,
which is what makes Render run it as a background worker.

---

## 10. Departures from the references, for review

Five departures were raised at the Phase 0 gate. **Two were reversed** by spec amendment at
the Phase 1 gate; three stand as built.

### Resolved — spec amended

1. ~~**No `shared/` workspace**~~ → **Amendment A**: `shared/` is adopted, matching both
   references. Zod contracts live in `@discern/shared`. `ARCHITECTURE.md` §3 tree updated.
2. ~~**`/health`, not `/healthz`**~~ → **Amendment B**: the route is `/healthz`, matching both
   references. `ARCHITECTURE.md` §9 and `render.yaml` updated.

### Standing departures

3. **`design/` is gitignored** (below). Corner deliberately tracks `design/` and argues for
   it — small, diffable output earns its history. `ARCHITECTURE.md` §3 and the Phase 0 prompt
   both say untracked, so untracked it is. **Confirmed at the Phase 1 gate.**
4. **Domain-nested `services/`** (§1). Neither reference subdivides. Discern has six genuinely
   separate domains and a flat directory would not survive Phase 6. **Confirmed.**
5. **Model IDs as config** (§2). Neither reference has it; Discern's four-tier routing
   requires swapping any tier without a code change. **Confirmed.**

### Gitignore

Union of both references' patterns: `node_modules/`, `dist/`, `.expo/`, `.env`, `.env.*`
(negating `!.env.example`), `coverage/`, build and native artifacts, `*.log`, `.DS_Store`,
worktrees — plus `marketing/` and `design/` per `ARCHITECTURE.md` §3.

Both ignored directories keep an on-disk `README.md` that is **not** committed. Do not add a
`!marketing/README.md` negation to force it into the index; Corner explicitly warns against
this and the same reasoning applies to `design/`.
