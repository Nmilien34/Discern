// Two fields where the client was asserting something only the server can know.
//
// Neither costs a point, which is what makes them worse than the ledger holes.
// One costs the truthfulness of a screen whose premise is that SHE noticed
// something; the other costs the axis the journal is read along.
//
// Own database. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createCarryingRequestSchema } from "@discern/shared";
import { CarryingModel, PassageModel, UserModel } from "../models";
// Direct, not from the barrel: the journal is deliberately not re-exported, so
// that reaching for it from the prompt or retrieval code does not compile.
import { JournalEntryModel } from "../models/journal-entry.model";
import { createEntry } from "../services/journal/journal.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-claims`,
      serverSelectionTimeoutMS: 1500,
    });
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

beforeEach(async () => {
  if (!connected) return;
  await Promise.all([
    JournalEntryModel.deleteMany({}),
    CarryingModel.deleteMany({}),
    PassageModel.deleteMany({ reference: /^Claim / }),
    UserModel.deleteMany({ deviceId: /^clm-test-/ }),
  ]);
  user = (await UserModel.create({ deviceId: `clm-test-${Date.now()}` }))._id;
});

describe("a client cannot claim Abigail gave it", () => {
  it("REFUSES the field outright rather than ignoring it", () => {
    // Removed from the request contract, not silently dropped. The object is
    // strict, so a client still sending `source` gets a 400 naming the field —
    // a loud wrong answer beats a quiet right one.
    const withSource = createCarryingRequestSchema.safeParse({
      reference: "Matthew 5:23-24",
      source: "abigail",
      why: "She gave you this because you kept saying forgive and meaning alone.",
    });
    expect(withSource.success).toBe(false);
    if (!withSource.success) {
      // Strict rejection reports one `unrecognized_keys` issue whose PATH IS
      // EMPTY — the offending keys live on the issue, and on the message. So
      // the 400 does name the field, but not where a caller would first look.
      const issue = withSource.error.issues[0]!;
      expect(issue.code).toBe("unrecognized_keys");
      expect((issue as unknown as { keys: string[] }).keys).toEqual(
        expect.arrayContaining(["source", "why"]),
      );
      expect(issue.message).toContain("source");
    }
  });

  it("accepts the request without it, which is all a client ever needed to send", () => {
    const plain = createCarryingRequestSchema.safeParse({ reference: "Matthew 5:23-24" });
    expect(plain.success).toBe(true);
    expect(plain.success && "source" in plain.data).toBe(false);
  });

  it("`why` is gone too — it is a sentence only she can write", () => {
    expect(
      createCarryingRequestSchema.safeParse({
        reference: "Matthew 5:23-24",
        why: "because I felt like it",
      }).success,
    ).toBe(false);
  });
});

describe("writtenAt is clamped, never refused", () => {
  const write = (writtenAt?: string) =>
    createEntry(user, {
      clientId: `c-${Math.random().toString(36).slice(2)}`,
      body: "Went. It took four minutes.",
      ...(writtenAt ? { writtenAt } : {}),
    });

  it("keeps a legitimately backdated entry — midnight about the afternoon", async ({ skip }) => {
    if (!connected) skip();
    const hoursAgo = new Date(Date.now() - 8 * 3_600_000).toISOString();
    expect((await write(hoursAgo)).entry.writtenAt).toBe(hoursAgo);
  });

  it("keeps an offline entry synced two weeks late", async ({ skip }) => {
    if (!connected) skip();
    // The window comes from what the write buffer can produce: a fortnight
    // abroad, a phone in a drawer. This has to survive.
    const twoWeeks = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect((await write(twoWeeks)).entry.writtenAt).toBe(twoWeeks);
  });

  it("CLAMPS THE FUTURE, which is the half that was doing damage", async ({ skip }) => {
    if (!connected) skip();
    // An entry dated 2050 sorts above everything the person ever writes, on the
    // axis the journal is primarily read along.
    const { entry } = await write("2050-01-01T00:00:00.000Z");
    expect(new Date(entry.writtenAt).getFullYear()).toBe(new Date().getFullYear());
    // AND IT IS STILL THERE. Refusing would have lost what they wrote.
    expect(entry.body).toBe("Went. It took four minutes.");
  });

  it("clamps the distant past to the edge of the window, not to now", async ({ skip }) => {
    if (!connected) skip();
    // Their intent was "a while ago" and it is honoured as far as it can be.
    const { entry } = await write("1970-01-01T00:00:00.000Z");
    const days = (Date.now() - new Date(entry.writtenAt).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("tolerates small clock skew forward without touching it", async ({ skip }) => {
    if (!connected) skip();
    const skewed = new Date(Date.now() + 60_000).toISOString();
    expect((await write(skewed)).entry.writtenAt).toBe(skewed);
  });

  it("NOTHING IS EVER REFUSED — every entry survives", async ({ skip }) => {
    if (!connected) skip();
    for (const t of ["2050-01-01T00:00:00.000Z", "1900-01-01T00:00:00.000Z", undefined]) {
      await write(t);
    }
    expect(await JournalEntryModel.countDocuments({ userId: user })).toBe(3);
  });
});
