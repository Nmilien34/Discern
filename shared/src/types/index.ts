import type {
  ATTRIBUTIONS,
  CARRYING_KINDS,
  CARRYING_SOURCES,
  ENTITLEMENT_STATUSES,
  GROWTH_STAGES,
  LINK_PROVIDERS,
  SEED_EVENT_TYPES,
  STAGE_SLUGS,
  HEALTH_STATUSES,
  LICENSE_TYPES,
  TESTAMENTS,
} from "../constants";

export type HealthStatus = (typeof HEALTH_STATUSES)[number];
export type LicenseType = (typeof LICENSE_TYPES)[number];
export type Attribution = (typeof ATTRIBUTIONS)[number];
export type TestamentName = (typeof TESTAMENTS)[number];
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];
export type LinkProvider = (typeof LINK_PROVIDERS)[number];
export type StageSlug = (typeof STAGE_SLUGS)[number];
export type SeedEventType = (typeof SEED_EVENT_TYPES)[number];
export type GrowthStage = (typeof GROWTH_STAGES)[number];
export type CarryingKind = (typeof CARRYING_KINDS)[number];
export type CarryingSource = (typeof CARRYING_SOURCES)[number];

export type { BookMeta, Testament } from "../constants/books";
