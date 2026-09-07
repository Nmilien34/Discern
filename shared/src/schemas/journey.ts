// Journey contracts: stages, carryings, and the derived seed.

import { z } from "zod";

import {
  CARRYING_KINDS,
  CARRYING_SOURCES,
  GROWTH_STAGES,
  READ_TYPES,
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

    /* ── CONTENT AVAILABILITY, DERIVED ────────────────────────────────────
     *
     * A virtue is available when it actually has published reads. Derived from
     * the database on every request — never a constant, never an environment
     * variable, never a list in the client.
     *
     * That single decision is what lets content land incrementally: write the
     * third virtue, publish it, and onboarding starts offering it with no
     * deploy and no coordinated release. It is also why staging and production
     * behave correctly with different content and no branching.
     *
     * The seven are ALWAYS all returned. "Which of these has been loudest" is a
     * question about the person, and hiding lust because nobody has written it
     * yet would be both dishonest and strange.
     */
    available: z.boolean(),
    /** Published reads in this virtue. Zero when `available` is false. */
    readCount: z.number().int().nonnegative(),
    /**
     * The title of the read this person would start on, for the reflection
     * screen and the paywall — both of which name it out loud.
     *
     * NULL WHEN THERE IS NOTHING TO NAME, so a surface that interpolates it
     * cannot render a promise the app cannot keep. That is the whole failure
     * this field exists to make impossible.
     */
    firstReadTitle: z.string().nullable(),
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
     * How many released carryings exist in total.
     *
     * `released` is a bounded page; this is the truth. Released carryings are
     * kept forever by design, so the count keeps growing while the payload
     * does not.
     */
    releasedTotal: z.number().int().nonnegative(),
    /**
     * The soft cap. Not a technical limit — the thesis. You cannot dwell on ten
     * things, and an unbounded list turns carryings into a reading queue.
     */
    activeCap: z.number().int().positive(),
    atCap: z.boolean(),
  })
  .strict();

export type CarryingsListResponse = z.infer<typeof carryingsListResponseSchema>;

export type CarryingNote = z.infer<typeof carryingNoteSchema>;

export const createCarryingRequestSchema = z
  .object({
    kind: z.enum(CARRYING_KINDS).default("passage"),
    /** A passage id, or a reference like "Ephesians 2:8-10". */
    reference: z.string().min(1).max(120),
    /*
     * `source` AND `why` ARE GONE FROM THIS REQUEST, 2026-09-07.
     *
     * They used to be here, and `source` accepted "abigail" — so a self-added
     * carrying could claim Abigail gave it, with an invented reason for why she
     * did. Nothing about that cost points, which is exactly what made it worse
     * than the ledger holes: it cost the truthfulness of a screen whose entire
     * premise is that SHE handed you this, at a moment chosen for you, for a
     * reason she can state. The released-carrying arc rests on the same claim.
     *
     * THE SERVER KNOWS. A carrying from Abigail came from the `offer_carrying`
     * tool call, which is now the only place `source: "abigail"` originates;
     * POST /v1/carryings hardcodes "self" and stores no `why`, because a
     * self-added carrying has no "why she gave you this" to render.
     *
     * REMOVED RATHER THAN IGNORED. This object is `.strict()`, so a client that
     * still sends `source` gets a 400 naming the field instead of having it
     * silently dropped — a loud wrong answer beats a quiet right one.
     *
     * Same shape as `enterStageRequestSchema.evidence`, where the route already
     * hardcodes "user" so a client cannot claim Abigail diagnosed it.
     */
  })
  .strict();

export type CreateCarryingRequest = z.input<typeof createCarryingRequestSchema>;

export const updateCarryingRequestSchema = z
  .object({
    /** Appends a note. Notes are never edited or removed. */
    note: z.string().min(1).max(4000).optional(),
    /**
     * FOREGROUND seconds spent with it since the last update. Also records a
     * revisit.
     *
     * THE CEILING IS 3,600 AND IT BUYS DATA QUALITY, NOT SAFETY. It was 14,400
     * — four hours — which validated nothing: a three-minute read cannot
     * produce four hours of attention, so every wrong value passed. Scoring
     * does not care either way, because `SEED_EVENT_WEIGHTS.dwell_time.cap`
     * stops paying at 1,200 seconds and the day stops at 20 points.
     *
     * What it costs to get wrong is the telemetry. If the client counts while
     * backgrounded, or double-counts on resume, then every engagement number we
     * later reason from is quietly inflated — and those numbers decide what
     * gets built. One hour is the outer edge of one person's continuous
     * attention on one passage; past it the client is wrong, not the reader.
     *
     * A value between PLAUSIBLE and this ceiling is accepted AND LOGGED — see
     * carryings.service.ts. A resume double-count produces believable numbers
     * rather than absurd ones, so a ceiling alone would never catch it.
     */
    dwellSeconds: z.number().int().positive().max(3_600).optional(),
    /** Marks it released. Kept, never deleted. */
    release: z.boolean().optional(),
  })
  .strict();

export type UpdateCarryingRequest = z.input<typeof updateCarryingRequestSchema>;

export const enterStageRequestSchema = z
  .object({
    stageSlug: z.enum(STAGE_SLUGS),
    evidence: z.string().max(2000).optional(),
  })
  .strict();

export type EnterStageRequest = z.input<typeof enterStageRequestSchema>;

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
    /**
     * THE SECOND AXIS: how recently this has been tended, 0.42-1.
     *
     * It softens the foliage's colour. It does NOT change the tree's size —
     * that is `growthStage`, which only ever goes up — so nothing a person has
     * done can be taken away by being away.
     *
     * THE FLOOR IS IN THE CONTRACT ON PURPOSE. `.min(0.42)` means a response
     * describing a dying tree cannot be sent: it fails validation in
     * development and is logged as a contract violation in production. The
     * design rule — never grey, never bare, never dropping leaves — is
     * therefore enforced by the type rather than remembered by a renderer.
     *
     * Not a streak. Nothing accumulates and nothing breaks; one return restores
     * it completely, the same day, with nothing to re-earn.
     */
    vigor: z.number().min(0.42).max(1),
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

/**
 * A cultivation read, as a card in the path.
 *
 * `completedAt` and `actionTakenAt` are THIS PERSON'S history, read straight
 * off the seed ledger rather than a separate completions store — the ledger
 * already records exactly this, and a second store would be a second truth.
 */
export const readSummarySchema = z
  .object({
    id: z.string(),
    order: z.number().int().positive(),
    type: z.enum(READ_TYPES),
    title: z.string(),
    runtimeSeconds: z.number().int().nonnegative(),
    /** False for most reads. Only a read with an ask can emit action_taken. */
    hasAction: z.boolean(),
    completedAt: z.string().nullable(),
    actionTakenAt: z.string().nullable(),
  })
  .strict();

export type ReadSummary = z.infer<typeof readSummarySchema>;

export const readsListResponseSchema = z
  .object({
    stageSlug: z.enum(STAGE_SLUGS),
    reads: z.array(readSummarySchema),
    /** "read 5 of 9" comes from these two, never from a client-side count. */
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type ReadsListResponse = z.infer<typeof readsListResponseSchema>;

export const readPassageSchema = z
  .object({
    /** As cited and as printed. Never substituted. */
    reference: z.string(),
    /**
     * EVERY stored pericope the citation touches, in verse order.
     *
     * An array because a citation is the unit that makes an argument and the
     * corpus was segmented on narrative seams; four of humility's eleven
     * citations straddle a boundary. These are what can be carried and what can
     * be given audio.
     */
    storedReferences: z.array(z.string()),
    runtimeSeconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const readDetailSchema = readSummarySchema
  .extend({
    header: z.string().nullable(),
    body: z.array(z.string()),
    passages: z.array(readPassageSchema),
    action: z.string().nullable(),
  })
  .strict();

export type ReadDetail = z.infer<typeof readDetailSchema>;

/**
 * POST /v1/journey/reads/:id/complete and .../action.
 *
 * `awarded` is false on a repeat. Both events are once-ever per read, so the
 * second call is not an error and is not a second award — the client can retry
 * safely and can tell the difference.
 */
export const readProgressResponseSchema = z
  .object({ read: readSummarySchema, awarded: z.boolean() })
  .strict();

export type ReadProgressResponse = z.infer<typeof readProgressResponseSchema>;

export const readDetailResponseSchema = z.object({ read: readDetailSchema }).strict();

export type ReadDetailResponse = z.infer<typeof readDetailResponseSchema>;

export const readsListQuerySchema = z
  .object({ stageSlug: z.enum(STAGE_SLUGS) })
  .strict();

export type ReadsListQuery = z.infer<typeof readsListQuerySchema>;

/** GET /v1/journey/stages — the seven stages themselves. Public config. */
export const stagesListResponseSchema = z
  .object({ stages: z.array(stageSchema) })
  .strict();

export type StagesListResponse = z.infer<typeof stagesListResponseSchema>;

/**
 * One row of the append-only ledger the seed is computed from.
 *
 * APPEND-ONLY, and there is no decay and no absence penalty. Nothing in this
 * shape can express a subtraction, which is deliberate: the app is against
 * streak mechanics, and a ledger that could go down is a streak.
 */
export const seedEventSchema = z
  .object({
    type: z.enum(SEED_EVENT_TYPES),
    /**
     * The raw event weight, before the curve in `config/seed-growth.ts`.
     *
     * DECLARED 2026-09-06. `readLedger` has always sent it and this schema was
     * `.passthrough()`, so it arrived undeclared — the client could not see it
     * in the contract and any client parsing strictly would have dropped it.
     * Found by the no-passthrough sweep, not by anyone looking.
     */
    weight: z.number(),
    points: z.number().nonnegative(),
    at: z.string(),
  })
  .strict();

export type SeedEvent = z.infer<typeof seedEventSchema>;

/**
 * STRICT, like every other schema here.
 *
 * This was `.passthrough()` — the one loose object in the package, which meant
 * the arc could carry fields nobody had declared and the client would never
 * know. Found on 2026-09-06 when response validation was turned on: passthrough
 * gives the inferred input an index signature, so the backend's own
 * `GrowthStageDefinition` would not satisfy it. A contract that its own server
 * cannot satisfy is a contract that was never checked.
 */
export const growthArcStepSchema = z
  .object({
    stage: z.enum(GROWTH_STAGES),
    label: z.string(),
    description: z.string(),
    threshold: z.number().nonnegative(),
  })
  .strict();

export const seedLedgerResponseSchema = z
  .object({
    events: z.array(seedEventSchema),
    arc: z.array(growthArcStepSchema),
  })
  .strict();

export type SeedLedgerResponse = z.infer<typeof seedLedgerResponseSchema>;

/**
 * GET /v1/carryings/:id/audio — the passage read aloud.
 *
 * VOICE ATTACHES TO A CARRYING, not to a turn: a person opens what they are
 * carrying and presses play, which is the moment an ear is actually useful.
 *
 * `url` is a SIGNED, EXPIRING S3 url. Do not cache it, do not persist it, and
 * fetch it again when the person presses play — a stored one starts failing
 * silently some time after it was issued.
 *
 * A refusal comes back HERE rather than as an error, because "voice is off
 * tonight" is something to tell the person, not something to swallow.
 */
export const passageAudioResponseSchema = z
  .object({
    reference: z.string(),
    translation: z.string(),
    url: z.string(),
    characters: z.number().int().nonnegative(),
    cached: z.boolean(),
    refusedReason: z.string().optional(),
  })
  .strict();

export type PassageAudioResponse = z.infer<typeof passageAudioResponseSchema>;
