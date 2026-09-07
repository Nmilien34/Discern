// The seed: APPENDED TO, NEVER UPDATED; COMPUTED, NEVER STORED.
//
// Two functions. `recordSeedEvent` appends one row. `computeSeed` reads the
// whole ledger and derives everything from the curve in config/seed-growth.ts.
// There is no third function that writes a score, and there should never be one.
//
// PRIVACY IS STRUCTURAL, not a permission check. Every function here takes a
// userId and filters on it; there is no query that spans users, no ranking, no
// percentile, and no comparison of any kind. ARCHITECTURE.md §1: the seed is
// private, never comparative, and it measures practice rather than holiness.

import type { SeedEventType, SeedResponse } from "@discern/shared";
import type { Types } from "mongoose";

import {
  GROWTH_STAGE_DEFINITIONS,
  growthStageFor,
  nextGrowthStageAfter,
  pointsForEvent,
  REVISITS_PER_CARRYING_PER_DAY,
  SEED_DAILY_CAPS,
  vigorFor,
} from "../../config/seed-growth";
import { logger } from "../../lib/logger";
import { SeedEventModel } from "../../models";

export interface RecordSeedEventInput {
  userId: Types.ObjectId;
  type: SeedEventType;
  /** MAGNITUDE — dwell seconds, conversation turns, or 1. Never points. */
  weight: number;
  sourceId?: Types.ObjectId | null;
}

/**
 * Appends one event. The only write path into the ledger.
 *
 * Never throws into the caller's flow: a failure to record practice must not
 * fail the practice itself. Someone releasing a carrying should not see an error
 * because the ledger was briefly unavailable.
 */
export async function recordSeedEvent(
  input: RecordSeedEventInput,
): Promise<void> {
  try {
    await SeedEventModel.create({
      userId: input.userId,
      type: input.type,
      weight: Math.max(0, input.weight),
      at: new Date(),
      sourceId: input.sourceId ?? null,
    });
  } catch (error) {
    // A DUPLICATE IS THE INDEX DOING ITS JOB, NOT A FAILURE. read_completed,
    // action_taken and stage_movement are unique on {userId, type, sourceId};
    // two concurrent requests both pass the services' `exists` check and both
    // insert, and the loser of that race gets E11000. The row it wanted already
    // exists, which is the outcome that was wanted, so this is silent.
    if ((error as { code?: number }).code === 11000) return;

    // EVERYTHING ELSE IS LOUD, and stays swallowed on purpose: a ledger write
    // that fails must not fail the user's action — they did the thing, and
    // refusing their apology because a points row would not save is the wrong
    // trade. But it was logged at `error` with only the type, which in practice
    // is a line nobody can act on. It now carries who and what, so a pattern is
    // visible rather than merely present.
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        type: input.type,
        userId: String(input.userId),
        sourceId: input.sourceId ? String(input.sourceId) : null,
        weight: input.weight,
      },
      "FAILED TO APPEND SEED EVENT — the user's action succeeded and their " +
        "ledger did not. This is silent to them by design and must not be " +
        "silent here.",
    );
  }
}

/**
 * Derives the whole seed from the ledger.
 *
 * Reads every event rather than a rolling aggregate, deliberately. The ledger is
 * small (a busy year of real practice is hundreds of rows, not millions), and
 * reading it whole is what makes retuning the curve instantaneous and total —
 * change a weight, and every user's seed is correct on the next request, with no
 * migration and no recomputation job.
 */
export async function computeSeed(
  userId: Types.ObjectId,
  /** Injectable so the vigor curve is testable without waiting a month. */
  now: Date = new Date(),
): Promise<SeedResponse> {
  const events = await SeedEventModel.find({ userId })
    .select("type weight at sourceId")
    .sort({ at: 1 })
    .lean();

  const byType = new Map<SeedEventType, { events: number; points: number }>();
  let points = 0;

  // Daily ceilings are applied HERE, at read time, not at write time.
  //
  // Without them dwell_time and revisit are farmable — the client supplies
  // dwellSeconds, and every PATCH also increments a revisit — so a loop is worth
  // Shelter in an afternoon. Capping on read keeps the ledger a faithful record
  // of what happened while letting the ceiling be an opinion in one config file.
  const dayPoints = new Map<string, number>();
  const revisitsPerCarryingPerDay = new Map<string, number>();

  for (const event of events) {
    const day = event.at.toISOString().slice(0, 10);

    // A revisit means coming back LATER, not tapping twice in one sitting.
    if (event.type === "revisit") {
      const key = `${day}:${String(event.sourceId ?? "none")}`;
      const already = revisitsPerCarryingPerDay.get(key) ?? 0;
      if (already >= REVISITS_PER_CARRYING_PER_DAY) continue;
      revisitsPerCarryingPerDay.set(key, already + 1);
    }

    let earned = pointsForEvent(event.type, event.weight);

    const dailyCap = SEED_DAILY_CAPS[event.type];
    if (dailyCap !== undefined) {
      const key = `${day}:${event.type}`;
      const spent = dayPoints.get(key) ?? 0;
      const room = Math.max(0, dailyCap - spent);
      earned = Math.min(earned, room);
      dayPoints.set(key, spent + earned);
    }

    points += earned;

    const bucket = byType.get(event.type) ?? { events: 0, points: 0 };
    bucket.events += 1;
    bucket.points += earned;
    byType.set(event.type, bucket);
  }

  // Rounded for display only. The underlying sum is never persisted, so rounding
  // here cannot accumulate error across reads.
  points = Math.round(points * 100) / 100;

  const current = growthStageFor(points);
  const next = nextGrowthStageAfter(current.stage);

  const spanStart = current.threshold;
  const spanEnd = next?.threshold ?? current.threshold;
  const span = spanEnd - spanStart;

  const progressInStage =
    next === null || span <= 0
      ? 1
      : Math.min(1, Math.max(0, (points - spanStart) / span));

  const first = events[0];
  const last = events[events.length - 1];

  // THE SECOND AXIS. Days since the last real event, whole days, floored at
  // zero so a clock skew cannot produce a negative. No events at all is null,
  // which vigorFor reads as FULL — a person who just arrived has neglected
  // nothing.
  const daysSinceTended = last
    ? Math.max(0, Math.floor((now.getTime() - last.at.getTime()) / 86_400_000))
    : null;

  return {
    growthStage: current.stage,
    growthStageLabel: current.label,
    growthStageDescription: current.description,
    points,
    nextStage: next?.stage ?? null,
    pointsToNextStage:
      next === null ? null : Math.max(0, Math.round((next.threshold - points) * 100) / 100),
    progressInStage: Math.round(progressInStage * 1000) / 1000,
    vigor: vigorFor(daysSinceTended),
    eventCount: events.length,
    contributions: [...byType.entries()]
      .map(([type, bucket]) => ({
        type,
        events: bucket.events,
        points: Math.round(bucket.points * 100) / 100,
      }))
      .sort((a, b) => b.points - a.points),
    firstEventAt: first ? first.at.toISOString() : null,
    lastEventAt: last ? last.at.toISOString() : null,
  };
}

/** The full ledger, for a user looking at their own history. */
export async function readLedger(
  userId: Types.ObjectId,
  limit = 100,
): Promise<
  { type: SeedEventType; weight: number; points: number; at: string }[]
> {
  const events = await SeedEventModel.find({ userId })
    .select("type weight at")
    .sort({ at: -1 })
    .limit(limit)
    .lean();

  return events.map((event) => ({
    type: event.type,
    weight: event.weight,
    points: Math.round(pointsForEvent(event.type, event.weight) * 100) / 100,
    at: event.at.toISOString(),
  }));
}

/** Exposed so a client can render the arc without hardcoding it. */
export function growthArc(): typeof GROWTH_STAGE_DEFINITIONS {
  return GROWTH_STAGE_DEFINITIONS;
}
