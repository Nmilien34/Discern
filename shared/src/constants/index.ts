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

/** ARCHITECTURE.md §6, seedEvents.type. */
export const SEED_EVENT_TYPES = [
  "dwell_time",
  "revisit",
  "conversation_depth",
  "premise_reframed",
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
