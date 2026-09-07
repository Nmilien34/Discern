// Cultivation reads: the path, one read, and finishing one.
//
// WHY THIS EXISTS NOW. Humility was finished on 2026-09-06 — nine reads, 4,147
// words, one action — and reading all of it earned NOTHING. Four of the six
// seed event types fire somewhere in the product; `read_completed` did not
// exist at all and `action_taken` had no writer, so a person could complete an
// entire virtue and watch a tree that had not moved. Every other number in the
// seed design assumed otherwise.
//
// TWO WRITES, AND THEY ARE DELIBERATELY DIFFERENT SIZES.
//
//   read_completed  2 points. Nine of them — a whole virtue — come to 18.
//   action_taken   25 points, uncapped. One thing done in real life.
//
// Reading about humility is not practising it, and the ledger says so.

import type { Types } from "mongoose";

import { NotFoundError, ValidationError } from "../../lib/errors";
import type { CultivationReadDocument } from "../../models/cultivation-read.model";
import { CultivationReadModel } from "../../models/cultivation-read.model";
import { SeedEventModel } from "../../models";
import { recordSeedEvent } from "./seed.service";
import type { ReadType, StageSlug } from "@discern/shared";

/** Live means published, with a date that has actually arrived. */
function publishedFilter(now: Date) {
  return { publishedAt: { $ne: null, $lte: now } };
}

export interface ReadSummary {
  id: string;
  order: number;
  type: ReadType;
  title: string;
  runtimeSeconds: number;
  hasAction: boolean;
  completedAt: string | null;
  actionTakenAt: string | null;
}

export interface ReadDetail extends ReadSummary {
  header: string | null;
  body: string[];
  passages: {
    reference: string;
    /** Every stored pericope the citation touches. Carryable, audio-capable. */
    storedReferences: string[];
    runtimeSeconds: number | null;
  }[];
  action: string | null;
}

/**
 * When this user finished each read, and when they marked its action done.
 *
 * ONE QUERY FOR THE WHOLE PATH rather than one per read. It reads the ledger
 * rather than a separate completions collection, which is the point: the ledger
 * already records exactly this, and a second store would be a second truth.
 */
async function historyFor(
  userId: Types.ObjectId,
  readIds: Types.ObjectId[],
): Promise<Map<string, { completedAt: Date | null; actionTakenAt: Date | null }>> {
  const rows = await SeedEventModel.find({
    userId,
    type: { $in: ["read_completed", "action_taken"] },
    sourceId: { $in: readIds },
  })
    .select("type sourceId at")
    .lean();

  const out = new Map<string, { completedAt: Date | null; actionTakenAt: Date | null }>();
  for (const row of rows) {
    const key = String(row.sourceId);
    const entry = out.get(key) ?? { completedAt: null, actionTakenAt: null };
    if (row.type === "read_completed") entry.completedAt = row.at;
    else entry.actionTakenAt = row.at;
    out.set(key, entry);
  }
  return out;
}

function summarize(
  read: CultivationReadDocument,
  history: Map<string, { completedAt: Date | null; actionTakenAt: Date | null }>,
): ReadSummary {
  const seen = history.get(String(read._id));
  return {
    id: String(read._id),
    order: read.order,
    type: read.type,
    title: read.title,
    runtimeSeconds: read.runtimeSeconds,
    hasAction: read.action !== null,
    completedAt: seen?.completedAt ? seen.completedAt.toISOString() : null,
    actionTakenAt: seen?.actionTakenAt ? seen.actionTakenAt.toISOString() : null,
  };
}

/** The path for one virtue, in order, with this person's progress on it. */
export async function listReads(
  userId: Types.ObjectId,
  stageSlug: StageSlug,
  now: Date = new Date(),
): Promise<{ stageSlug: StageSlug; reads: ReadSummary[]; completed: number; total: number }> {
  const reads = await CultivationReadModel.find({
    stageSlug,
    ...publishedFilter(now),
  }).sort({ order: 1 });

  const history = await historyFor(
    userId,
    reads.map((r) => r._id),
  );
  const summaries = reads.map((r) => summarize(r, history));

  return {
    stageSlug,
    reads: summaries,
    completed: summaries.filter((r) => r.completedAt !== null).length,
    total: summaries.length,
  };
}

async function loadLive(readId: string, now: Date): Promise<CultivationReadDocument> {
  const read = await CultivationReadModel.findOne({
    _id: readId,
    ...publishedFilter(now),
  }).catch(() => null);
  // An unpublished read is NOT FOUND rather than forbidden. Staged content
  // should not be discoverable by probing ids.
  if (!read) throw new NotFoundError("Read not found");
  return read;
}

export async function getRead(
  userId: Types.ObjectId,
  readId: string,
  now: Date = new Date(),
): Promise<ReadDetail> {
  const read = await loadLive(readId, now);
  const history = await historyFor(userId, [read._id]);
  return {
    ...summarize(read, history),
    header: read.header,
    body: read.body,
    passages: read.passages.map((p) => ({
      reference: p.reference,
      storedReferences: p.storedReferences,
      runtimeSeconds: p.runtimeSeconds,
    })),
    action: read.action,
  };
}

/**
 * Marks a read finished. IDEMPOTENT, AND ONCE EVER.
 *
 * Not once per day: re-reading is genuinely valuable and the ledger already
 * pays for returning through `revisit`. Paying `read_completed` again for the
 * same read would make the number mean "times opened".
 *
 * The check is on the ledger itself — `{userId, type, sourceId}` — so there is
 * no second store that could disagree with it.
 */
export async function completeRead(
  userId: Types.ObjectId,
  readId: string,
  now: Date = new Date(),
): Promise<{ read: ReadSummary; awarded: boolean }> {
  const read = await loadLive(readId, now);

  const already = await SeedEventModel.exists({
    userId,
    type: "read_completed",
    sourceId: read._id,
  });

  if (!already) {
    await recordSeedEvent({
      userId,
      type: "read_completed",
      weight: 1,
      sourceId: read._id as Types.ObjectId,
    });
  }

  return {
    read: summarize(read, await historyFor(userId, [read._id])),
    awarded: !already,
  };
}

/**
 * "This happened" — the person went and did the thing the read asked.
 *
 * THIS IS THE HEAVIEST EVENT IN THE LEDGER, 25 points and uncapped, and it is
 * the only one earned OUTSIDE the app. Humility's read 5 is currently the one
 * read in the product that has an action: "Go to the person you were wrong
 * about, and say so out loud. Not by message. This week."
 *
 * REFUSED ON A READ WITH NO ACTION, rather than silently awarded. A read
 * without an ask has nothing to have happened, and letting the client name any
 * read here would make 25 points available for a tap.
 *
 * Once ever, like completion, and for the same reason.
 */
export async function markActionTaken(
  userId: Types.ObjectId,
  readId: string,
  now: Date = new Date(),
): Promise<{ read: ReadSummary; awarded: boolean }> {
  const read = await loadLive(readId, now);

  if (read.action === null) {
    throw new ValidationError("This read has no action", [
      { path: "id", message: "the read does not ask for anything to be done" },
    ]);
  }

  const already = await SeedEventModel.exists({
    userId,
    type: "action_taken",
    sourceId: read._id,
  });

  if (!already) {
    await recordSeedEvent({
      userId,
      type: "action_taken",
      weight: 1,
      sourceId: read._id as Types.ObjectId,
    });
  }

  return {
    read: summarize(read, await historyFor(userId, [read._id])),
    awarded: !already,
  };
}
