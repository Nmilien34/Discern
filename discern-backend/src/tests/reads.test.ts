// Cultivation reads, and the two writes that move the seed.
//
// The property under test is an ORDERING, not a feature: finishing an entire
// virtue must be worth less than doing one thing in real life. Humility is nine
// reads and 4,147 words; at 2 points each that is 18, against 25 for a single
// action_taken. An app that paid more for reading about humility than for going
// and apologising would be teaching the opposite of what its reads say.
//
// Own database — account-deletion.test.ts wipes collections wholesale and
// vitest runs files in parallel. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pointsForEvent, SEED_DAILY_CAPS } from "../config/seed-growth";
import { NotFoundError, ValidationError } from "../lib/errors";
import { SeedEventModel, UserModel } from "../models";
import { CultivationReadModel } from "../models/cultivation-read.model";
import {
  completeRead,
  getRead,
  listReads,
  markActionTaken,
} from "../services/journey/reads.service";
import { computeSeed } from "../services/journey/seed.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-reads`,
      serverSelectionTimeoutMS: 1500,
    });
    connected = true;
  } catch {
    connected = false;
  }
});

afterAll(async () => {
  if (connected) await mongoose.disconnect();
});

let user: mongoose.Types.ObjectId;

/** Nine published reads, one of which asks for something. Humility's shape. */
async function seedPath(): Promise<void> {
  await CultivationReadModel.insertMany(
    Array.from({ length: 9 }, (_u, i) => ({
      stageSlug: "pride-humility",
      order: i + 1,
      type: "teaching",
      title: `Read ${i + 1}`,
      runtimeSeconds: 180,
      body: ["x"],
      passages: [],
      action: i === 4 ? "Go and say so out loud." : null,
      publishedAt: new Date("2026-09-01"),
    })),
  );
}

beforeEach(async () => {
  if (!connected) return;
  await CultivationReadModel.deleteMany({});
  await SeedEventModel.collection.deleteMany({});
  await UserModel.deleteMany({ deviceId: /^rd-test-/ });
  user = (await UserModel.create({ deviceId: `rd-test-${Date.now()}` }))._id;
  await seedPath();
});

const idOf = async (order: number) =>
  String((await CultivationReadModel.findOne({ order }))!._id);

describe("the ordering the whole ledger rests on", () => {
  it("nine reads are worth LESS than one action", () => {
    const wholeVirtue = 9 * pointsForEvent("read_completed", 1);
    const oneAction = pointsForEvent("action_taken", 1);
    expect(wholeVirtue).toBe(18);
    expect(oneAction).toBe(25);
    expect(wholeVirtue).toBeLessThan(oneAction);
  });

  it("has no daily cap, because it is already bounded absolutely", () => {
    // Each read pays once and there are nine. A daily ceiling would only punish
    // somebody who read the whole path in an afternoon.
    expect(SEED_DAILY_CAPS.read_completed).toBeUndefined();
  });
});

describe("completing a read", () => {
  it("awards once, and a repeat is not an error and not a second award", async ({ skip }) => {
    if (!connected) skip();
    const id = await idOf(1);

    const first = await completeRead(user, id);
    const again = await completeRead(user, id);

    expect(first.awarded).toBe(true);
    expect(again.awarded).toBe(false);
    expect(again.read.completedAt).toBe(first.read.completedAt);
    expect(await SeedEventModel.countDocuments({ userId: user, type: "read_completed" })).toBe(1);
  });

  it("re-reading NEVER pays again, not even on another day", async ({ skip }) => {
    if (!connected) skip();
    const id = await idOf(1);
    await completeRead(user, id);
    await completeRead(user, id, new Date("2027-01-01"));
    expect(await SeedEventModel.countDocuments({ userId: user })).toBe(1);
  });

  it("reading the whole path reaches Root, and stops well short of Shoot", async ({ skip }) => {
    if (!connected) skip();
    for (let order = 1; order <= 9; order += 1) await completeRead(user, await idOf(order));

    const seed = await computeSeed(user);
    expect(seed.points).toBe(18);
    // Root moved 25 -> 10 on 2026-09-06 precisely so this would be true: a
    // person who reads the whole virtue and does nothing else sees the tree
    // move. Before the change they finished at 18 and were still a Seed.
    expect(seed.growthStage).toBe("root");
    // And nowhere near Shoot at 75 — reading is not the practice.
    expect(seed.points).toBeLessThan(75);
    expect(seed.eventCount).toBe(9);
  });

  it("an unpublished read is NOT FOUND, not forbidden", async ({ skip }) => {
    if (!connected) skip();
    await CultivationReadModel.updateOne({ order: 3 }, { $set: { publishedAt: null } });
    await expect(completeRead(user, await idOf(3))).rejects.toThrow(NotFoundError);
  });
});

describe("this happened", () => {
  it("is REFUSED on a read that asks for nothing", async ({ skip }) => {
    if (!connected) skip();
    // Otherwise 25 points — the heaviest award in the system — is available for
    // a tap on any read the client cares to name.
    await expect(markActionTaken(user, await idOf(1))).rejects.toThrow(ValidationError);
    expect(await SeedEventModel.countDocuments({ type: "action_taken" })).toBe(0);
  });

  it("awards 25 once on the read that does ask", async ({ skip }) => {
    if (!connected) skip();
    const id = await idOf(5);

    expect((await markActionTaken(user, id)).awarded).toBe(true);
    expect((await markActionTaken(user, id)).awarded).toBe(false);

    const seed = await computeSeed(user);
    expect(seed.points).toBe(25);
    expect(seed.growthStage).toBe("root");
    // One action alone still outruns the entire written virtue, which is 18.
    expect(seed.points).toBeGreaterThan(9 * 2);
  });

  it("one action outweighs the entire written virtue", async ({ skip }) => {
    if (!connected) skip();
    for (let order = 1; order <= 9; order += 1) await completeRead(user, await idOf(order));
    const readingOnly = (await computeSeed(user)).points;

    await markActionTaken(user, await idOf(5));
    const withAction = (await computeSeed(user)).points;

    expect(readingOnly).toBe(18);
    expect(withAction - readingOnly).toBe(25);
    expect(withAction - readingOnly).toBeGreaterThan(readingOnly);
  });
});

describe("the path, as the client sees it", () => {
  it("reports read N of 9 from the server, not a client-side count", async ({ skip }) => {
    if (!connected) skip();
    await completeRead(user, await idOf(1));
    await completeRead(user, await idOf(2));

    const path = await listReads(user, "pride-humility");
    expect(path.total).toBe(9);
    expect(path.completed).toBe(2);
    expect(path.reads.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(path.reads[0]!.completedAt).not.toBeNull();
    expect(path.reads[2]!.completedAt).toBeNull();
    // Only read 5 asks for anything.
    expect(path.reads.filter((r) => r.hasAction).map((r) => r.order)).toEqual([5]);
  });

  it("hides unpublished reads from the count as well as the list", async ({ skip }) => {
    if (!connected) skip();
    await CultivationReadModel.updateMany({ order: { $gte: 7 } }, { $set: { publishedAt: null } });
    const path = await listReads(user, "pride-humility");
    expect(path.total).toBe(6);
    expect(path.reads.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("does not leak another person's progress", async ({ skip }) => {
    if (!connected) skip();
    const other = (await UserModel.create({ deviceId: `rd-test-b-${Date.now()}` }))._id;
    await completeRead(other, await idOf(1));

    const mine = await listReads(user, "pride-humility");
    expect(mine.completed).toBe(0);
    expect((await getRead(user, await idOf(1))).completedAt).toBeNull();
  });
});
