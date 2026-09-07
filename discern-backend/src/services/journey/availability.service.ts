// WHICH VIRTUES ACTUALLY HAVE CONTENT.
//
// Derived from published reads on every request. Never a constant, never an
// environment variable, never a list in the client — because the moment it is
// any of those, shipping the third virtue becomes a deploy and a coordinated
// release instead of a publish.
//
// The problem it solves: the launch plan is two virtues written and five not.
// Onboarding asks which of the seven vices has been loudest, then the
// reflection screen names the person's virtue and the TITLE of their first
// read, and the paywall repeats it. Without this, five out of seven people are
// promised a read that does not exist, immediately before being asked to pay.

import { STAGE_SLUGS } from "@discern/shared";
import type { StageSlug } from "@discern/shared";

import { CultivationReadModel } from "../../models";

export interface StageAvailability {
  available: boolean;
  readCount: number;
  /** Title of the read a new person would start on. Null when there is none. */
  firstReadTitle: string | null;
}

/** Published means: a date that is set, and not in the future. */
function publishedFilter(now: Date) {
  return { publishedAt: { $ne: null, $lte: now } };
}

/**
 * One entry per stage in STAGE_SLUGS, always — including the ones with nothing.
 *
 * A stage with no content is `{ available: false, readCount: 0,
 * firstReadTitle: null }`, present rather than missing. Absence and "not ready"
 * are different answers and a caller should not have to tell them apart by
 * checking whether a key exists.
 */
export async function stageAvailability(
  now: Date = new Date(),
): Promise<Record<StageSlug, StageAvailability>> {
  const counts = await CultivationReadModel.aggregate<{
    _id: StageSlug;
    readCount: number;
    firstOrder: number;
  }>([
    { $match: publishedFilter(now) },
    { $group: { _id: "$stageSlug", readCount: { $sum: 1 }, firstOrder: { $min: "$order" } } },
  ]);

  // One extra query, not one per stage: the titles of the first published read
  // in each stage that has any.
  const firsts = counts.length
    ? await CultivationReadModel.find({
        ...publishedFilter(now),
        $or: counts.map((c) => ({ stageSlug: c._id, order: c.firstOrder })),
      })
        .select("stageSlug title")
        .lean()
    : [];

  const titleByStage = new Map(firsts.map((r) => [r.stageSlug, r.title]));
  const countByStage = new Map(counts.map((c) => [c._id, c.readCount]));

  const out = {} as Record<StageSlug, StageAvailability>;
  for (const slug of STAGE_SLUGS) {
    const readCount = countByStage.get(slug) ?? 0;
    out[slug] = {
      available: readCount > 0,
      readCount,
      firstReadTitle: readCount > 0 ? (titleByStage.get(slug) ?? null) : null,
    };
  }
  return out;
}

/** The subset with content, in STAGE_SLUGS order. */
export async function availableStages(now?: Date): Promise<StageSlug[]> {
  const all = await stageAvailability(now);
  return STAGE_SLUGS.filter((s) => all[s].available);
}

/* ── THE ASSIGNMENT RULE ──────────────────────────────────────────────────── */

export type StartingStageDecision =
  | { kind: "start"; stageSlug: StageSlug }
  | {
      kind: "choose";
      /** What they may start on now. Never empty when this is returned. */
      offer: StageSlug[];
      /** What they actually named that is not ready. Said back to them, plainly. */
      named: StageSlug[];
    }
  | { kind: "nothing-available"; named: StageSlug[] };

/**
 * If they selected several and at least one has content, start them there.
 *
 * If they selected several and NONE have content, do not pick something
 * arbitrary for them — that is the app quietly overruling the one thing it just
 * asked. Return `choose`, so the screen can offer what is ready and say plainly
 * that the one they named is being written.
 *
 * Selection order is preserved: `selected` is the order the person tapped, and
 * the first of theirs that is ready wins over the first that happens to be
 * earliest in STAGE_SLUGS.
 */
export async function resolveStartingStage(
  selected: readonly StageSlug[],
  now?: Date,
): Promise<StartingStageDecision> {
  const available = new Set(await availableStages(now));

  const theirs = selected.find((s) => available.has(s));
  if (theirs) return { kind: "start", stageSlug: theirs };

  const offer = STAGE_SLUGS.filter((s) => available.has(s));
  const named = [...selected];

  // Nothing at all is published. Not a state the app should ever be in, but a
  // caller that assumes `offer` is non-empty would render an empty screen, so
  // it is named rather than left to be discovered.
  if (offer.length === 0) return { kind: "nothing-available", named };

  return { kind: "choose", offer, named };
}
