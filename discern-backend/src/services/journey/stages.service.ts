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
import { StageModel, UserModel, UserStageModel } from "../../models";
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

  // Movement is practice; entering the first stage is movement too.
  await recordSeedEvent({ userId, type: "stage_movement", weight: 1 });

  return getCurrentStage(userId);
}

export async function listStages() {
  return StageModel.find().sort({ order: 1 }).lean();
}
