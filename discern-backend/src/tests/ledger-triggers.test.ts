// Three events named for rare things that fired on routine ones.
//
// One bug, three instances, and the fix is at the TRIGGER in all three — not at
// the weight and not at the cap:
//
//   revisit          fired on first contact, before anything had been left
//   stage_movement   fired on any slug change, including a return
//   premise_reframed fires on ~70% of turns (capped here; trigger is next)
//
// The seven weights are unchanged and there is a test below that says so.
//
// Own database. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pointsForEvent, SEED_DAILY_CAPS } from "../config/seed-growth";
import { CarryingModel, SeedEventModel, StageModel, UserModel } from "../models";
import { updateCarrying } from "../services/journey/carryings.service";
import { computeSeed } from "../services/journey/seed.service";
import { enterStage } from "../services/journey/stages.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-triggers`,
      serverSelectionTimeoutMS: 1500,
    });
    await SeedEventModel.syncIndexes();
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
  await SeedEventModel.collection.deleteMany({});
  await CarryingModel.deleteMany({});
  await StageModel.deleteMany({});
  await UserModel.deleteMany({ deviceId: /^trg-test-/ });
  user = (await UserModel.create({ deviceId: `trg-test-${Date.now()}` }))._id;
  await StageModel.insertMany(
    ["pride-humility", "wrath-patience"].map((slug, i) => ({
      slug,
      order: i + 1,
      from: slug.split("-")[0]!,
      to: slug.split("-").slice(1).join("-"),
      description: "x",
    })),
  );
});

const carry = async () =>
  CarryingModel.create({
    userId: user, kind: "passage", refId: new mongoose.Types.ObjectId(),
  });

describe("revisit: a first contact is not a return", () => {
  it("pays NOTHING on the first dwell, and 8 on the second", async ({ skip }) => {
    if (!connected) skip();
    const c = await carry();

    await updateCarrying(user, String(c._id), { dwellSeconds: 300 });
    expect(await SeedEventModel.countDocuments({ userId: user, type: "revisit" })).toBe(0);
    // The dwell itself still counts — only the return does not exist yet.
    expect(await SeedEventModel.countDocuments({ userId: user, type: "dwell_time" })).toBe(1);

    await updateCarrying(user, String(c._id), { dwellSeconds: 300 });
    expect(await SeedEventModel.countDocuments({ userId: user, type: "revisit" })).toBe(1);
  });

  it("is per carrying, not global — a second carrying starts fresh", async ({ skip }) => {
    if (!connected) skip();
    const a = await carry();
    const b = await carry();
    await updateCarrying(user, String(a._id), { dwellSeconds: 300 });
    await updateCarrying(user, String(a._id), { dwellSeconds: 300 });
    await updateCarrying(user, String(b._id), { dwellSeconds: 300 });
    // a: first contact then a return. b: first contact only.
    expect(await SeedEventModel.countDocuments({ userId: user, type: "revisit" })).toBe(1);
  });

  it("the weight is untouched at 8", () => {
    expect(pointsForEvent("revisit", 1)).toBe(8);
    // And the cap it already had is left alone; it did not need another.
    expect(SEED_DAILY_CAPS.revisit).toBe(16);
  });
});

describe("stage_movement: you enter a virtue once", () => {
  it("ALTERNATING TWO SLUGS PAYS 20, THEN 20, THEN NOTHING", async ({ skip }) => {
    if (!connected) skip();
    // The degenerate path. Before this, each request was 20 points with no cap
    // and no rate limiter: Root in one request, Shelter in fifty.
    for (const slug of ["pride-humility", "wrath-patience", "pride-humility", "wrath-patience"] as const) {
      await enterStage(user, slug, "user");
    }
    expect(await SeedEventModel.countDocuments({ userId: user, type: "stage_movement" })).toBe(2);
    expect((await computeSeed(user)).points).toBe(40);
  });

  it("is bounded by content: seven virtues, 140 points, ever", async ({ skip }) => {
    if (!connected) skip();
    const seven = pointsForEvent("stage_movement", 1) * 7;
    expect(seven).toBe(140);
    // Which is the same shape as read_completed and action_taken — a lifetime
    // total set by how much content exists, not by a daily ceiling.
    expect(SEED_DAILY_CAPS.stage_movement).toBeUndefined();
  });

  it("the DATABASE refuses a duplicate, not just the check above it", async ({ skip }) => {
    if (!connected) skip();
    await enterStage(user, "pride-humility", "user");
    const existing = await SeedEventModel.findOne({ userId: user, type: "stage_movement" }).lean();

    // Bypassing the service entirely — this is what two concurrent requests do.
    await expect(
      SeedEventModel.collection.insertOne({
        userId: user, type: "stage_movement", weight: 1, at: new Date(),
        sourceId: existing!.sourceId, createdAt: new Date(), updatedAt: new Date(),
      } as never),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("premise_reframed: capped because a model decides it", () => {
  it("pays one reframing a day, however many turns say so", async ({ skip }) => {
    if (!connected) skip();
    const conversation = new mongoose.Types.ObjectId();
    const at = new Date("2026-09-07T10:00:00.000Z");
    for (let i = 0; i < 10; i += 1) {
      await SeedEventModel.create({
        userId: user, type: "premise_reframed", weight: 1, at, sourceId: conversation,
      });
    }
    const seed = await computeSeed(user, at);
    expect(SEED_DAILY_CAPS.premise_reframed).toBe(15);
    expect(seed.points).toBe(15);
    // Ten reframings used to be 150 points. A hundred and fifty turns — the
    // daily rate limit — used to be 2,250, which is Shelter twice over.
    expect(seed.points).toBeLessThan(pointsForEvent("premise_reframed", 1) * 2);
  });

  it("still outranked by one thing done in real life, which is the whole point", () => {
    expect(SEED_DAILY_CAPS.premise_reframed!).toBeLessThan(pointsForEvent("action_taken", 1));
  });
});

describe("no weight moved", () => {
  it("all seven are exactly what they were", () => {
    expect(pointsForEvent("dwell_time", 1200)).toBe(10);
    expect(pointsForEvent("revisit", 1)).toBe(8);
    expect(pointsForEvent("conversation_depth", 6)).toBe(6);
    expect(pointsForEvent("premise_reframed", 1)).toBe(15);
    expect(pointsForEvent("read_completed", 1)).toBe(2);
    expect(pointsForEvent("action_taken", 1)).toBe(25);
    expect(pointsForEvent("stage_movement", 1)).toBe(20);
  });
});
