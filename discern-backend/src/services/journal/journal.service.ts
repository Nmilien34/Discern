// The journal.
//
// TWO AXES, per round 13: by time, and by what you were carrying. Both are this
// one list query with a different filter, so the released-carrying surface —
// "everything you wrote while you had it" — is a filtered read rather than a
// second code path.
//
// THE JOURNAL NEVER REACHES ABIGAIL. This service is imported by exactly one
// route file and by nothing else; the prompt, retrieval and cultivation
// directories cannot import it (eslint) and cannot reach the model through the
// models barrel (it is not re-exported). See src/tests/journal-isolation.test.ts.
//
// Nothing here embeds, summarises, classifies or enriches an entry. There is no
// nightly job over this collection. The body goes in, comes back out, and is
// deleted with the account.

import type {
  JournalEntry,
  JournalExportResponse,
  JournalListResponse,
  JournalOrigin,
} from "@discern/shared";
import mongoose from "mongoose";
import type { Types } from "mongoose";

import { NotFoundError, ValidationError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { JournalEntryDocument } from "../../models/journal-entry.model";
import { JournalEntryModel } from "../../models/journal-entry.model";
import { CarryingModel, HymnModel, PassageModel } from "../../models";

/**
 * HOW FAR BACK A REPORTED `writtenAt` CAN PLAUSIBLY BE, and why 30 days.
 *
 * The number comes from what the offline write buffer can actually produce.
 * Local storage holds an entry until the app next runs with a network, so a
 * legitimately backdated entry is bounded by how long somebody can go without
 * the app successfully reaching us. A fortnight abroad, a phone in a drawer
 * over a holiday, a bad month — all inside this. A gap longer than thirty days
 * is not the buffer working, it is a clock that is wrong.
 *
 * Deliberately generous, because the cost is asymmetric: clamping a real entry
 * misdates it, and misdating is visible and recoverable.
 */
const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * AND ALMOST NONE FORWARD. Five minutes is device clock skew, which is real and
 * which nobody can do anything about. Beyond that there is no legitimate way to
 * have written something: the buffer can only ever be late.
 *
 * This is the half that was actually doing damage. An entry dated 2050 sorts
 * above everything the person ever writes, forever, on the axis the journal is
 * primarily read along.
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Brings a reported write time inside the plausible window. NEVER REJECTS.
 *
 * A refused write loses somebody's journal entry. A clamped one is off by a
 * date and still says what they said, and the log line is what makes the
 * clamping visible rather than silent — a stream of these from one build is a
 * clock bug, and this is the only place it would show.
 */
function clampWrittenAt(
  raw: string | undefined,
  userId: Types.ObjectId,
  now: Date,
): Date {
  if (!raw) return now;

  const reported = new Date(raw);
  if (Number.isNaN(reported.getTime())) return now;

  const earliest = new Date(now.getTime() - MAX_BACKDATE_MS);
  const latest = new Date(now.getTime() + MAX_CLOCK_SKEW_MS);

  if (reported < earliest || reported > latest) {
    const clamped = reported < earliest ? earliest : now;
    logger.warn(
      {
        userId: String(userId),
        reported: reported.toISOString(),
        clampedTo: clamped.toISOString(),
        direction: reported < earliest ? "too far back" : "in the future",
      },
      "journal writtenAt outside the plausible window — clamped, not refused",
    );
    return clamped;
  }

  return reported;
}

function serialize(entry: JournalEntryDocument): JournalEntry {
  return {
    id: String(entry._id),
    body: entry.body,
    carryingId: entry.carryingId ? String(entry.carryingId) : null,
    passageReference: entry.passageReference,
    origin: entry.origin,
    writtenAt: entry.writtenAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function toObjectId(value: string, field: string): Types.ObjectId {
  if (!mongoose.isValidObjectId(value)) {
    throw new ValidationError(`Invalid ${field}`, [
      { path: field, message: "must be an id" },
    ]);
  }
  return new mongoose.Types.ObjectId(value);
}

/**
 * Resolves the carrying an entry attaches to, and the reference to freeze onto
 * it.
 *
 * The reference is copied rather than joined because a released carrying is
 * routine — the active cap is three — and the chip has to keep reading
 * "Matthew 5:23-24" for as long as the entry exists.
 *
 * A carrying id belonging to someone else is NOT FOUND, not forbidden: telling
 * a caller that an id exists but is not theirs is itself a disclosure.
 */
async function resolveCarrying(
  userId: Types.ObjectId,
  carryingId: string | null | undefined,
): Promise<{ id: Types.ObjectId | null; reference: string | null }> {
  if (!carryingId) return { id: null, reference: null };

  const id = toObjectId(carryingId, "carryingId");
  const carrying = await CarryingModel.findOne({ _id: id, userId })
    .select("kind refId")
    .lean();
  if (!carrying) throw new NotFoundError("Carrying not found");

  // Denormalise the label the chip shows.
  const reference =
    carrying.kind === "passage"
      ? ((await PassageModel.findById(carrying.refId).select("reference").lean())
          ?.reference ?? null)
      : ((await HymnModel.findById(carrying.refId).select("title").lean())?.title ??
        null);

  return { id, reference };
}

/**
 * Writes an entry, or returns the one this `clientId` already made.
 *
 * A RETRY IS NOT AN EDIT. The offline buffer resends the same clientId until it
 * gets an answer, so re-posting an existing one returns the stored entry
 * unchanged rather than overwriting it with what the buffer still holds — the
 * buffer's copy can be older than an edit made on another device.
 */
export async function createEntry(
  userId: Types.ObjectId,
  input: {
    clientId: string;
    body: string;
    carryingId?: string | null;
    origin?: JournalOrigin;
    writtenAt?: string;
  },
): Promise<{ entry: JournalEntry; created: boolean }> {
  const existing = await JournalEntryModel.findOne({
    userId,
    clientId: input.clientId,
  });
  if (existing) return { entry: serialize(existing), created: false };

  const carrying = await resolveCarrying(userId, input.carryingId);

  try {
    const entry = await JournalEntryModel.create({
      userId,
      clientId: input.clientId,
      body: input.body,
      carryingId: carrying.id,
      passageReference: carrying.reference,
      origin: input.origin ?? "journal",
      writtenAt: clampWrittenAt(input.writtenAt, userId, new Date()),
    });
    return { entry: serialize(entry), created: true };
  } catch (error) {
    // Two retries of the same offline write racing each other. The unique index
    // is what makes this safe; losing the race is not an error, it means the
    // other one already wrote the entry.
    if ((error as { code?: number }).code === 11000) {
      const raced = await JournalEntryModel.findOne({
        userId,
        clientId: input.clientId,
      });
      if (raced) return { entry: serialize(raced), created: false };
    }
    throw error;
  }
}

export async function listEntries(
  userId: Types.ObjectId,
  query: { carryingId?: string; limit: number; before?: string },
): Promise<JournalListResponse> {
  const filter: Record<string, unknown> = { userId };
  if (query.carryingId) {
    filter.carryingId = toObjectId(query.carryingId, "carryingId");
  }
  if (query.before) filter.writtenAt = { $lt: new Date(query.before) };

  // One extra row decides whether there is a next page, without a second count.
  const rows = await JournalEntryModel.find(filter)
    .sort({ writtenAt: -1 })
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;

  // `total` is the whole journal, deliberately ignoring both the filter and the
  // page: the empty state says "three years in", and that number is the whole
  // of what someone has written, not what this screen is showing.
  const total = await JournalEntryModel.countDocuments({ userId });

  return {
    entries: page.map(serialize),
    total,
    nextBefore:
      hasMore && page.length > 0
        ? page[page.length - 1]!.writtenAt.toISOString()
        : null,
  };
}

export async function updateEntry(
  userId: Types.ObjectId,
  entryId: string,
  body: string,
): Promise<JournalEntry> {
  const entry = await JournalEntryModel.findOneAndUpdate(
    { _id: toObjectId(entryId, "id"), userId },
    { $set: { body } },
    { new: true },
  );
  if (!entry) throw new NotFoundError("Entry not found");
  return serialize(entry);
}

export async function deleteEntry(
  userId: Types.ObjectId,
  entryId: string,
): Promise<void> {
  const result = await JournalEntryModel.deleteOne({
    _id: toObjectId(entryId, "id"),
    userId,
  });
  if (result.deletedCount === 0) throw new NotFoundError("Entry not found");
}

/**
 * The whole journal, unpaged, oldest first.
 *
 * OFFERED BEFORE THE DESTRUCTIVE TAP. The deletion screen now says the journal
 * goes with the account and to export it first, and that sentence is only
 * honest if this is reachable at the moment someone is leaving — which is often
 * a moment when their subscription has already lapsed. So the route that serves
 * this sits outside the entitlement gate. See app.ts.
 *
 * Oldest first because an export is read as a document, not as a feed.
 */
export async function exportJournal(
  userId: Types.ObjectId,
): Promise<JournalExportResponse> {
  const entries = await JournalEntryModel.find({ userId }).sort({ writtenAt: 1 });
  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.map(serialize),
  };
}
