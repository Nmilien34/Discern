// Values both the API and the app must agree on.

export * from "./books";

/** Health states reported by GET /healthz. */
export const HEALTH_STATUSES = ["ok", "degraded"] as const;

/** ARCHITECTURE.md §6, translations.licenseType. */
export const LICENSE_TYPES = ["public-domain", "licensed"] as const;

/**
 * ARCHITECTURE.md §6, authors.attribution.
 *
 * The reason this is a first-class field rather than a footnote: Hebrews, Job,
 * Judges, Kings, Chronicles and Esther have no settled author, and presenting
 * contested authorship as fact loses trust permanently with anyone who knows.
 * Admitting uncertainty is the trust-building move in this category.
 */
export const ATTRIBUTIONS = ["traditional", "disputed", "unknown"] as const;

export const TESTAMENTS = ["old", "new"] as const;

/**
 * Entitlement states. ARCHITECTURE.md §6, users.entitlement.
 *
 * `free` and `expired` are distinct on purpose: someone who has never paid and
 * someone whose subscription lapsed are in different places, and the second is
 * the one worth writing to.
 */
export const ENTITLEMENT_STATUSES = [
  "free",
  "trialing",
  "active",
  "active_canceled",
  "past_due",
  "expired",
] as const;

/** Statuses that grant paid access right now. */
export const PAID_ENTITLEMENT_STATUSES = [
  "trialing",
  "active",
  "active_canceled",
] as const;

export const LINK_PROVIDERS = ["apple", "google", "email"] as const;

/**
 * ARCHITECTURE.md §1: the seven stages, each a movement from a disposition to
 * its opposite. Anchored in Colossians 3:5-14 and Ephesians 4:22-24 — the put
 * off / put on passages — NOT in the medieval vice list, which names only the
 * thing being put off and has nothing to say about what replaces it.
 */
export const STAGE_SLUGS = [
  "pride-humility",
  "greed-generosity",
  "lust-pure-love",
  "envy-gratitude",
  "gluttony-temperance",
  "wrath-patience",
  "sloth-diligence",
] as const;

/**
 * The worker's job types.
 *
 * Here rather than in the backend's job model because the job-health contract
 * has to enumerate them: a job that has never run must come back as a present
 * row saying so, and it can only do that if the API and the client agree on the
 * full list independently of what the `jobs` collection happens to contain.
 */
/**
 * Why a read exists. The mix is the point: every other app in this category
 * ships inspiring examples only, and FAILURE — someone who missed the virtue,
 * and what they could have done — is the type that makes the path ours.
 */
export const READ_TYPES = ["teaching", "failure", "example"] as const;

export type ReadType = (typeof READ_TYPES)[number];

export const JOB_TYPES = [
  "embedding-backfill",
  "tts-pregenerate",
  "memory-summarize",
  "notification-schedule",
  "notification-send",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

/** ARCHITECTURE.md §6, seedEvents.type. */
export const SEED_EVENT_TYPES = [
  "dwell_time",
  "revisit",
  "conversation_depth",
  "premise_reframed",
  /**
   * ADDED 2026-09-06, when humility's nine reads were finished and it became
   * plain that reading four thousand words earned nothing at all.
   *
   * Deliberately the SMALLEST weight in the ledger: finishing a whole virtue
   * must stay worth less than one thing done in real life. See
   * config/seed-growth.ts for the arithmetic.
   */
  "read_completed",
  "action_taken",
  "stage_movement",
] as const;

/**
 * The growth arc, from Matthew 13:31-32: "the least of all seeds… becometh a
 * tree, so that the birds of the air come and lodge in the branches thereof."
 *
 * The arc therefore ends in something that SHELTERS OTHERS, not in a bigger
 * seed. That is the whole point of choosing this parable over a progress bar.
 */
export const GROWTH_STAGES = [
  "seed",
  "root",
  "shoot",
  "sapling",
  "branching",
  "shelter",
] as const;

export const CARRYING_KINDS = ["passage", "hymn"] as const;
export const CARRYING_SOURCES = ["abigail", "self"] as const;
export const STAGE_ENTERED_BY = ["abigail", "user"] as const;

/**
 * What was on screen when a journal entry was started.
 *
 * PROVENANCE, NOT A CATEGORY — round 13 was explicit that the journal has no
 * mood selector and no tags. This records what the person was looking at when
 * they opened the compose screen, which is the second chip on that screen, and
 * it is the only classification the journal has.
 */
/**
 * THE TEN ONBOARDING ASKS, as closed sets where the design offers options.
 *
 * Screens 3, 9 and 10 are free text and have no enum: a name, what is going on,
 * and who is involved. The rest are pick-one or pick-many, and the values below
 * are the options the canvas actually draws — not a superset invented here.
 *
 * Stored as SLUGS rather than as the copy. The copy on screen 4 is a full
 * sentence ("Something happened and I can't stop thinking about it"), and
 * storing sentences means a wording change silently invalidates every stored
 * answer.
 */

/** Screen 4. One option is deliberately not a crisis. */
export const ONBOARDING_BROUGHT = [
  "cant-stop-thinking",
  "keep-doing-it",
  "want-to-read",
  "dont-know",
] as const;

export type OnboardingBrought = (typeof ONBOARDING_BROUGHT)[number];

/** Screen 12 — how much she explains before she quotes. Her job, not their knowledge. */
export const ONBOARDING_FAMILIARITY = [
  "a-line-of-context",
  "assume-i-know",
  "explain-like-im-new",
] as const;

export type OnboardingFamiliarity = (typeof ONBOARDING_FAMILIARITY)[number];

/** Screen 14. Shapes what is offered, never what is allowed. */
export const ONBOARDING_TIME_AVAILABLE = [
  "a-few-minutes",
  "about-twenty",
  "an-hour-or-more",
] as const;

export type OnboardingTimeAvailable = (typeof ONBOARDING_TIME_AVAILABLE)[number];

/**
 * Reader type size. Round 14: the reader is the most-used screen and people's
 * eyes differ.
 */
export const TYPE_SIZES = ["small", "medium", "large", "x-large"] as const;

export type TypeSize = (typeof TYPE_SIZES)[number];

export const JOURNAL_ORIGINS = ["journal", "prayer", "read", "carrying"] as const;

export type JournalOrigin = (typeof JOURNAL_ORIGINS)[number];

export type StageEnteredBy = (typeof STAGE_ENTERED_BY)[number];

/**
 * Every `error.code` the API can send. CONVENTIONS.md §3.
 *
 * The app branches on THESE, never on message text. A message is copy and gets
 * rewritten; a code is the contract. Mirrors `lib/errors.ts` exactly — the two
 * 503s are separate values on purpose, because only one of them means "retry":
 *
 *   paymentRequired    402. A positive no. Show the paywall.
 *   accessUnavailable  503. We cannot TELL. Retry. NEVER a paywall.
 *
 * Collapsing those two locks a paying subscriber out of the whole product
 * during a provider outage, which with no free tier is the entire app.
 */
export const ERROR_CODES = {
  validation: "validation_error",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not_found",
  paymentRequired: "payment_required",
  conflict: "conflict",
  rateLimited: "rate_limited",
  upstreamUnavailable: "upstream_unavailable",
  accessUnavailable: "access_unavailable",
  reasoningBudgetExhausted: "reasoning_budget_exhausted",
  internal: "internal_error",
  notImplemented: "not_implemented",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
