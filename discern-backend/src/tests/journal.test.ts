// The journal, against a real database.
//
// Two things are being tested and only one of them is CRUD.
//
// The first is the offline write buffer's contract: local storage stays the
// buffer so an entry survives being offline, and the buffer retries until it is
// answered. If a retry could produce a second entry, someone who wrote on a
// plane finds four copies of the same night; if a retry could overwrite, an
// edit made on another device is silently reverted by a stale buffer. Both are
// tested here, including the racing case, because the unique index is what
// makes it safe and an index is only correct if it is actually there.
//
// The second is the round-13 attachment — an entry belongs to whatever was
// being carried when it was written — and the release case in particular:
// releasing a carrying is routine (the active cap is three) and the entry has
// to keep its chip afterwards.
//
// Runs against local mongod, in ITS OWN DATABASE.
//
// Vitest runs test files in parallel, and account-deletion.test.ts wipes the
// journal, carryings and passages collections wholesale in its beforeEach —
// correctly, for what it is testing. Two files sharing one database means one
// of them deletes the other's fixtures mid-assertion, which is a flake that
// looks like a bug in the code under test. A separate dbName costs nothing and
// removes the shared state rather than sequencing around it.
//
// Skips rather than fails when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../lib/errors";
import { CarryingModel, PassageModel, UserModel } from "../models";
import { JournalEntryModel } from "../models/journal-entry.model";
import {
  createEntry,
  deleteEntry,
  exportJournal,
  listEntries,
  updateEntry,
} from "../services/journal/journal.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-journal`,
      serverSelectionTimeoutMS: 1500,
    });
    // The retry test depends on {userId, clientId} being unique, so the index
    // has to exist before it runs. syncIndexes does at boot what this does here.
    await JournalEntryModel.syncIndexes();
    connected = true;
  } catch {
    connected = false;
  }
});

afterAll(async () => {
  if (connected) await mongoose.disconnect();
});

let user: mongoose.Types.ObjectId;
let other: mongoose.Types.ObjectId;

beforeEach(async () => {
  if (!connected) return;
  await Promise.all([
    JournalEntryModel.deleteMany({}),
    CarryingModel.deleteMany({}),
    PassageModel.deleteMany({ reference: /^Test / }),
    UserModel.deleteMany({ deviceId: /^jr-test-/ }),
  ]);
  user = (await UserModel.create({ deviceId: `jr-test-a-${Date.now()}` }))._id;
  other = (await UserModel.create({ deviceId: `jr-test-b-${Date.now()}` }))._id;
});

const write = (userId: mongoose.Types.ObjectId, over: Record<string, unknown> = {}) =>
  createEntry(userId, {
    clientId: `c-${Math.random().toString(36).slice(2)}`,
    body: "Went. It took four minutes.",
    ...over,
  });

describe("the offline write buffer", () => {
  it("a retry with the same clientId returns the SAME entry, not a second one", async ({ skip }) => {
    if (!connected) skip();

    const first = await write(user, { clientId: "buffer-1" });
    const retry = await createEntry(user, {
      clientId: "buffer-1",
      body: "Went. It took four minutes.",
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.entry.id).toBe(first.entry.id);
    expect(await JournalEntryModel.countDocuments({ userId: user })).toBe(1);
  });

  it("a retry does NOT overwrite an edit made somewhere else", async ({ skip }) => {
    if (!connected) skip();

    const first = await write(user, { clientId: "buffer-2", body: "first draft" });
    await updateEntry(user, first.entry.id, "edited on the other phone");

    // The buffer still holds the original text and resends it.
    const retry = await createEntry(user, {
      clientId: "buffer-2",
      body: "first draft",
    });

    expect(retry.entry.body).toBe("edited on the other phone");
  });

  it("two retries racing produce one entry, not an E11000 in the caller's face", async ({ skip }) => {
    if (!connected) skip();

    const both = await Promise.all([
      createEntry(user, { clientId: "race-1", body: "x" }),
      createEntry(user, { clientId: "race-1", body: "x" }),
    ]);

    expect(both[0].entry.id).toBe(both[1].entry.id);
    expect(await JournalEntryModel.countDocuments({ userId: user })).toBe(1);
  });

  it("the same clientId from two different people is two entries", async ({ skip }) => {
    if (!connected) skip();

    // Uniqueness is scoped to the user. Two phones minting the same id must not
    // make one of them lose an entry.
    await createEntry(user, { clientId: "same", body: "mine" });
    await createEntry(other, { clientId: "same", body: "theirs" });

    expect(await JournalEntryModel.countDocuments({})).toBe(2);
  });

  it("keeps the client's clock, not the server's", async ({ skip }) => {
    if (!connected) skip();

    // Written on a plane, synced two days later. It belongs to the night it was
    // written, and createdAt records when we first saw it.
    const written = "2026-09-01T23:40:00.000Z";
    const { entry } = await write(user, { writtenAt: written });

    expect(entry.writtenAt).toBe(written);
    expect(new Date(entry.createdAt).getTime()).toBeGreaterThan(
      new Date(written).getTime(),
    );
  });
});

describe("the two axes", () => {
  it("by time, newest first, and paged", async ({ skip }) => {
    if (!connected) skip();

    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      await write(user, { writtenAt: `${day}T10:00:00.000Z` });
    }

    const page = await listEntries(user, { limit: 2 });
    expect(page.entries.map((e) => e.writtenAt.slice(0, 10))).toEqual([
      "2026-09-03",
      "2026-09-02",
    ]);
    expect(page.total).toBe(3);
    expect(page.nextBefore).not.toBeNull();

    const rest = await listEntries(user, { limit: 2, before: page.nextBefore! });
    expect(rest.entries.map((e) => e.writtenAt.slice(0, 10))).toEqual(["2026-09-01"]);
    expect(rest.nextBefore).toBeNull();
    // `total` is the whole journal, not the page and not the filter: the empty
    // state says "three years in" off this number.
    expect(rest.total).toBe(3);
  });

  it("by what you were carrying — and the chip SURVIVES the release", async ({ skip }) => {
    if (!connected) skip();

    const passage = await PassageModel.create({
      reference: "Test Matthew 5:23-24",
      bookSlug: "matthew",
      chapter: 5,
      startVerse: 23,
      endVerse: 24,
      endChapter: 5,
      searchText: "leave there thy gift before the altar",
    });
    const carrying = await CarryingModel.create({
      userId: user,
      kind: "passage",
      refId: passage._id,
    });

    const held = await write(user, { carryingId: String(carrying._id) });
    await write(user); // unattached, same journal

    expect(held.entry.passageReference).toBe("Test Matthew 5:23-24");

    // Releasing is routine — the active cap is three, so a fourth forces one
    // down — and this is the surface round 13 called free: everything written
    // while holding it, still readable, still labelled.
    await CarryingModel.updateOne(
      { _id: carrying._id },
      { $set: { releasedAt: new Date() } },
    );

    const held2 = await listEntries(user, {
      limit: 50,
      carryingId: String(carrying._id),
    });
    expect(held2.entries).toHaveLength(1);
    expect(held2.entries[0]!.passageReference).toBe("Test Matthew 5:23-24");
    expect(held2.total).toBe(2);
  });

  it("refuses to attach an entry to someone else's carrying", async ({ skip }) => {
    if (!connected) skip();

    const theirs = await CarryingModel.create({
      userId: other,
      kind: "passage",
      refId: new mongoose.Types.ObjectId(),
    });

    // NOT FOUND rather than forbidden: telling a caller that an id exists but
    // is not theirs is itself a disclosure.
    await expect(write(user, { carryingId: String(theirs._id) })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("one person's journal is one person's", () => {
  it("never lists, edits, deletes or exports another user's entries", async ({ skip }) => {
    if (!connected) skip();

    const mine = await write(user, { body: "mine" });
    const theirs = await write(other, { body: "theirs" });

    expect((await listEntries(user, { limit: 50 })).entries).toHaveLength(1);
    await expect(updateEntry(user, theirs.entry.id, "x")).rejects.toThrow(NotFoundError);
    await expect(deleteEntry(user, theirs.entry.id)).rejects.toThrow(NotFoundError);

    const exported = await exportJournal(user);
    expect(exported.count).toBe(1);
    expect(exported.entries[0]!.id).toBe(mine.entry.id);
    expect(await JournalEntryModel.countDocuments({ userId: other })).toBe(1);
  });
});

describe("export", () => {
  it("is the whole journal, oldest first, unpaged", async ({ skip }) => {
    if (!connected) skip();

    for (const day of ["2026-09-03", "2026-09-01", "2026-09-02"]) {
      await write(user, { writtenAt: `${day}T10:00:00.000Z` });
    }

    // Oldest first, because an export is read as a document rather than a feed.
    const exported = await exportJournal(user);
    expect(exported.count).toBe(3);
    expect(exported.entries.map((e) => e.writtenAt.slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });
});
