// Gives the 21 pre-existing `stage_movement` rows the stage they belong to.
//
//   npx tsx src/scripts/backfill-stage-movement-source.ts          dry run
//   npx tsx src/scripts/backfill-stage-movement-source.ts --apply
//
// WHY THIS HAS TO RUN BEFORE THE INDEX. `stage_movement` is now deduped
// once-ever on {userId, type, sourceId}, enforced by a unique partial index —
// but every row written before 2026-09-07 carries `sourceId: null`, because the
// trigger never set one. Two consequences, and the second is the reason this
// script exists rather than a note:
//
//   1. The guard would not cover history. Twenty users could enter a virtue
//      they have already entered and be paid 20 points again.
//   2. THE INDEX CANNOT BE CREATED. One user has two stage_movement rows, both
//      with a null sourceId, which is a duplicate key under the new index.
//      syncIndexes() would fail at boot.
//
// HOW A ROW IS MATCHED. `enterStage` writes the userStage and then the ledger
// row, microseconds apart, so each event is matched to the userStage for the
// same user with the NEAREST `enteredAt`. Nearest rather than a time window,
// because the one user with two rows entered two virtues 2.6 seconds apart and
// a five-second window matches both.
//
// A row that cannot be matched to exactly one userStage is LEFT ALONE and
// reported. Guessing a virtue somebody entered is worse than a null.

import mongoose from "mongoose";

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { logger } from "../lib/logger";
import { assertWritable } from "../lib/production-guard";
import { SeedEventModel, StageModel, UserStageModel } from "../models";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  if (apply) assertWritable("backfill-stage-movement-source.ts");
  await connectToDatabase();

  const rows = await SeedEventModel.find({
    type: "stage_movement",
    sourceId: null,
  })
    .select("userId at")
    .lean();

  if (rows.length === 0) {
    logger.info("no stage_movement rows with a null sourceId — nothing to do");
    await disconnectFromDatabase();
    return;
  }

  const stageIdBySlug = new Map(
    (await StageModel.find().select("slug").lean()).map((s) => [s.slug, s._id]),
  );

  const matched: { id: unknown; stageId: unknown; slug: string; skewMs: number }[] = [];
  const unmatched: string[] = [];

  for (const row of rows) {
    const candidates = await UserStageModel.find({ userId: row.userId })
      .select("stageSlug enteredAt")
      .lean();

    if (candidates.length === 0) {
      unmatched.push(`${String(row._id)} — user has no userStages at all`);
      continue;
    }

    // Nearest by time, and the runner-up has to be clearly further away or the
    // match is a guess.
    const ranked = candidates
      .map((c) => ({ c, skew: Math.abs(+c.enteredAt - +row.at) }))
      .sort((a, b) => a.skew - b.skew);

    const best = ranked[0]!;
    const runnerUp = ranked[1];
    if (runnerUp && runnerUp.skew - best.skew < 500) {
      unmatched.push(
        `${String(row._id)} — two userStages within 500ms of each other; ambiguous`,
      );
      continue;
    }

    const stageId = stageIdBySlug.get(best.c.stageSlug);
    if (!stageId) {
      unmatched.push(`${String(row._id)} — no Stage document for "${best.c.stageSlug}"`);
      continue;
    }

    matched.push({
      id: row._id,
      stageId,
      slug: best.c.stageSlug,
      skewMs: best.skew,
    });
  }

  logger.info(
    {
      rows: rows.length,
      matched: matched.length,
      unmatched: unmatched.length,
      worstSkewMs: matched.reduce((m, x) => Math.max(m, x.skewMs), 0),
      slugs: matched.reduce<Record<string, number>>((a, m) => {
        a[m.slug] = (a[m.slug] ?? 0) + 1;
        return a;
      }, {}),
      applied: apply,
    },
    apply ? "backfilling" : "DRY RUN — would backfill",
  );

  for (const u of unmatched) logger.warn({ row: u }, "left alone");

  if (!apply) {
    logger.info("nothing written. Re-run with --apply.");
    await disconnectFromDatabase();
    return;
  }

  const result = await SeedEventModel.bulkWrite(
    matched.map((m) => ({
      updateOne: { filter: { _id: m.id }, update: { $set: { sourceId: m.stageId } } },
    })) as Parameters<typeof SeedEventModel.bulkWrite>[0],
    { ordered: false },
  );

  const remaining = await SeedEventModel.countDocuments({
    type: "stage_movement",
    sourceId: null,
  });

  logger.info(
    { modified: result.modifiedCount, remainingNull: remaining },
    remaining === 0
      ? "done — every stage_movement row now names its stage, and the unique index can be created"
      : "done, but rows remain with a null sourceId — the unique index will still refuse if any two share a user",
  );

  await disconnectFromDatabase();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "backfill-stage-movement-source failed");
  void mongoose.disconnect().finally(() => process.exit(1));
});
