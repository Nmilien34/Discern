// Entering and reading stages.
//
// A stage is entered by 'abigail' (with evidence) or by 'user'. Phase 6 wires
// Abigail's note_stage tool to enterStage(); Phase 5 builds the mechanism and
// the manual path.
//
// Entering a stage closes the previous one rather than stacking: someone is
// working through one thing at a time, and a list of seven simultaneous open
// stages would be a dashboard rather than a path.

import type { CurrentStageResponse, StageSlug } from "@discern/shared";
import type { Types } from "mongoose";

import { NotFoundError } from "../../lib/errors";
import { SeedEventModel, StageModel, UserModel, UserStageModel } from "../../models";
import { stageAvailability } from "./availability.service";
import { recordSeedEvent } from "./seed.service";

export async function getCurrentStage(
  userId: Types.ObjectId,
): Promise<CurrentStageResponse> {
  const history = await UserStageModel.find({ userId })
    .sort({ enteredAt: -1 })
    .lean();

  const open = history.find((entry) => entry.closedAt === null) ?? null;
  const stage = open
    ? await StageModel.findOne({ slug: open.stageSlug }).lean()
    : null;

  const toUserStage = (entry: (typeof history)[number]) => ({
    id: String(entry._id),
    stageSlug: entry.stageSlug,
    enteredAt: entry.enteredAt.toISOString(),
    enteredBy: entry.enteredBy,
    evidence: entry.evidence,
    closedAt: entry.closedAt ? entry.closedAt.toISOString() : null,
  });

  return {
    current: open ? toUserStage(open) : null,
    stage: stage
      ? {
          slug: stage.slug,
          order: stage.order,
          from: stage.from,
          to: stage.to,
          description: stage.description,
          anchorPassages: stage.anchorPassages,
          openingQuestions: stage.openingQuestions,
          // The path section only ever shows a virtue WITH content, and it
          // reads this rather than assuming the stage somebody is on has reads.
          // Someone can be assigned a stage that is later unpublished.
          ...(await stageAvailability())[stage.slug],
        }
      : null,
    history: history.map(toUserStage),
  };
}

export async function enterStage(
  userId: Types.ObjectId,
  stageSlug: StageSlug,
  enteredBy: "abigail" | "user",
  evidence?: string,
): Promise<CurrentStageResponse> {
  const stage = await StageModel.findOne({ slug: stageSlug });

  if (!stage) {
    throw new NotFoundError(
      `No stage "${stageSlug}". Run: npm run seed:stages -w @discern/backend`,
    );
  }

  const open = await UserStageModel.findOne({ userId, closedAt: null });

  if (open && open.stageSlug === stageSlug) {
    // Already here. Re-entering the same stage is not movement.
    return getCurrentStage(userId);
  }

  if (open) {
    open.closedAt = new Date();
    await open.save();
  }

  await UserStageModel.create({
    userId,
    stageSlug,
    enteredBy,
    evidence: evidence ?? null,
    enteredAt: new Date(),
  });

  await UserModel.updateOne({ _id: userId }, { $set: { currentStageSlug: stageSlug } });

  // MOVEMENT IS ENTERING A VIRTUE, ONCE. Returning to one is not movement.
  //
  // This used to fire on any slug change, guarded only by "not the one you are
  // already in" — so alternating two slugs paid 20 points a request, with no
  // cap and no rate limiter. Root in one request, Shelter in fifty.
  //
  // Deduped once-ever on {userId, type, sourceId}, exactly as read_completed
  // and action_taken are, which removes the hole rather than bounding it: seven
  // virtues exist, so lifetime stage_movement is 140 points and is limited by
  // content the way the other two are. Alternating pays 20, then 20, then
  // nothing.
  //
  // `sourceId` is the STAGE DOCUMENT'S id — the natural ObjectId identity for a
  // virtue, already loaded above. The 21 rows that predate this carry null and
  // are backfilled by scripts/backfill-stage-movement-source.ts; without that,
  // those twenty users could earn a virtue's 20 points a second time.
  //
  // The unique index on {userId, type, sourceId} is what actually enforces
  // this. The check below is a fast path, not the guarantee — two concurrent
  // requests would both pass it.
  const alreadyEntered = await SeedEventModel.exists({
    userId,
    type: "stage_movement",
    sourceId: stage._id,
  });

  if (!alreadyEntered) {
    await recordSeedEvent({
      userId,
      type: "stage_movement",
      weight: 1,
      sourceId: stage._id as Types.ObjectId,
    });
  }

  return getCurrentStage(userId);
}

/**
 * The seven, each with whether it currently has content.
 *
 * ALL SEVEN, ALWAYS. The "which has been loudest" screen shows every one of
 * them; the "which one first" screen filters on `available`. Filtering here
 * would make the first screen impossible to build correctly.
 */
export async function listStages() {
  const [stages, availability] = await Promise.all([
    StageModel.find().sort({ order: 1 }).lean(),
    stageAvailability(),
  ]);

  return stages.map((stage) => ({ ...stage, ...availability[stage.slug] }));
}
