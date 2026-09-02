// Journey contracts: stages, carryings, and the derived seed.

import { z } from "zod";

import {
  CARRYING_KINDS,
  CARRYING_SOURCES,
  GROWTH_STAGES,
  SEED_EVENT_TYPES,
  STAGE_ENTERED_BY,
  STAGE_SLUGS,
} from "../constants";

export const stageSchema = z
  .object({
    slug: z.enum(STAGE_SLUGS),
    order: z.number().int().positive(),
    from: z.string(),
    to: z.string(),
    description: z.string(),
    /** References that exist as STORED passages. Asserted at seed time. */
    anchorPassages: z.array(z.string()),
    openingQuestions: z.array(z.string()),
  })
  .strict();

export type Stage = z.infer<typeof stageSchema>;

export const userStageSchema = z
  .object({
    id: z.string(),
    stageSlug: z.enum(STAGE_SLUGS),
    enteredAt: z.string(),
    enteredBy: z.enum(STAGE_ENTERED_BY),
    /** Why this stage was named. Required when Abigail names it. */
    evidence: z.string().nullable(),
    closedAt: z.string().nullable(),
  })
  .strict();

export type UserStage = z.infer<typeof userStageSchema>;

export const currentStageResponseSchema = z
  .object({
    /** Null before any stage has been entered. The reader works without one. */
    current: userStageSchema.nullable(),
    stage: stageSchema.nullable(),
    history: z.array(userStageSchema),
  })
  .strict();

export type CurrentStageResponse = z.infer<typeof currentStageResponseSchema>;

export const carryingNoteSchema = z
  .object({ text: z.string(), at: z.string() })
  .strict();

export const carryingSchema = z
  .object({
    id: z.string(),
    kind: z.enum(CARRYING_KINDS),
    /** Passage or hymn id. */
    refId: z.string(),
    /** Resolved for display, so a list does not need N follow-up calls. */
    reference: z.string().nullable(),
    text: z.string().nullable(),
    addedAt: z.string(),
    source: z.enum(CARRYING_SOURCES),
    /** Abigail's reason for handing this over. Null when self-added. */
    why: z.string().nullable(),
    revisitCount: z.number().int().nonnegative(),
    lastVisitedAt: z.string().nullable(),
    totalDwellSeconds: z.number().int().nonnegative(),
    notes: z.array(carryingNoteSchema),
    releasedAt: z.string().nullable(),
  })
  .strict();

export type Carrying = z.infer<typeof carryingSchema>;

export const carryingsListResponseSchema = z
  .object({
    active: z.array(carryingSchema),
    released: z.array(carryingSchema),
    /**
     * The soft cap. Not a technical limit — the thesis. You cannot dwell on ten
     * things, and an unbounded list turns carryings into a reading queue.
     */
    activeCap: z.number().int().positive(),
    atCap: z.boolean(),
  })
  .strict();

export type CarryingsListResponse = z.infer<typeof carryingsListResponseSchema>;

export const createCarryingRequestSchema = z
  .object({
    kind: z.enum(CARRYING_KINDS).default("passage"),
    /** A passage id, or a reference like "Ephesians 2:8-10". */
    reference: z.string().min(1).max(120),
    source: z.enum(CARRYING_SOURCES).default("self"),
    why: z.string().max(2000).optional(),
  })
  .strict();

export const updateCarryingRequestSchema = z
  .object({
    /** Appends a note. Notes are never edited or removed. */
    note: z.string().min(1).max(4000).optional(),
    /** Seconds spent with it since the last update. Also records a revisit. */
    dwellSeconds: z.number().int().positive().max(14_400).optional(),
    /** Marks it released. Kept, never deleted. */
    release: z.boolean().optional(),
  })
  .strict();

export const enterStageRequestSchema = z
  .object({
    stageSlug: z.enum(STAGE_SLUGS),
    evidence: z.string().max(2000).optional(),
  })
  .strict();

/**
 * The seed. PRIVATE, always — no leaderboard, no comparison, no sharing.
 *
 * It measures PRACTICE, not holiness, and it is computed from the append-only
 * ledger on every read rather than stored. There is deliberately no endpoint
 * that returns another user's seed, and there should never be one.
 */
export const seedResponseSchema = z
  .object({
    growthStage: z.enum(GROWTH_STAGES),
    growthStageLabel: z.string(),
    /** What this stage means, in plain words. */
    growthStageDescription: z.string(),
    points: z.number().nonnegative(),
    /** Null at the final stage — the arc ends, it does not loop. */
    nextStage: z.enum(GROWTH_STAGES).nullable(),
    pointsToNextStage: z.number().nonnegative().nullable(),
    /** 0-1 within the CURRENT stage. Never a percentage of "done". */
    progressInStage: z.number().min(0).max(1),
    eventCount: z.number().int().nonnegative(),
    contributions: z.array(
      z
        .object({
          type: z.enum(SEED_EVENT_TYPES),
          events: z.number().int().nonnegative(),
          points: z.number().nonnegative(),
        })
        .strict(),
    ),
    firstEventAt: z.string().nullable(),
    lastEventAt: z.string().nullable(),
  })
  .strict();

export type SeedResponse = z.infer<typeof seedResponseSchema>;
