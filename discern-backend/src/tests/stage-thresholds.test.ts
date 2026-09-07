// The stage thresholds, and what a trial week is actually worth.
//
// THE SEVEN DAYS OF THE TRIAL ARE THE ONLY WEEK THAT DECIDES ANYTHING, and the
// tree is the product's argument for itself. So what the ledger does in that
// week is a product property, not an implementation detail, and it is pinned
// here with real events through the real `computeSeed` — not with arithmetic
// that could agree with a broken implementation.
//
// Root moved 25 -> 10 on 2026-09-06 so that a reads-only week moves the tree.
// These tests hold both halves of that: that it now does, and that the carrying
// path still overshoots for a reason the change did not address.
//
// Own database. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GROWTH_STAGE_DEFINITIONS,
  growthStageFor,
  pointsForEvent,
  SEED_DAILY_CAPS,
} from "../config/seed-growth";
import { SeedEventModel, UserModel } from "../models";
import { computeSeed } from "../services/journey/seed.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-stages`,
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

const DAY0 = new Date("2026-09-01T09:00:00.000Z");
const day = (n: number) => new Date(DAY0.getTime() + n * 86_400_000);

let user: mongoose.Types.ObjectId;

beforeEach(async () => {
  if (!connected) return;
  await SeedEventModel.collection.deleteMany({});
  await UserModel.deleteMany({ deviceId: /^stg-test-/ });
  user = (await UserModel.create({ deviceId: `stg-test-${Date.now()}` }))._id;
});

const thresholdOf = (stage: string) =>
  GROWTH_STAGE_DEFINITIONS.find((s) => s.stage === stage)!.threshold;

/** Runs a seven-day week and reports the day each stage was first reached. */
async function trialWeek(plan: (d: number) => { read?: boolean; dwellSeconds?: number; carryings?: number }) {
  const carryings = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const firstDayAt: Record<string, number> = {};
  /** Carryings this person has already had contact with. */
  const touched = new Set<string>();
  const pointsByDay: number[] = [];

  for (let d = 0; d < 7; d += 1) {
    const p = plan(d);
    if (p.read) {
      await SeedEventModel.create({
        userId: user, type: "read_completed", weight: 1, at: day(d),
        sourceId: new mongoose.Types.ObjectId(),
      });
    }
    for (let c = 0; c < (p.carryings ?? (p.dwellSeconds ? 1 : 0)); c += 1) {
      await SeedEventModel.create({
        userId: user, type: "dwell_time", weight: p.dwellSeconds!, at: day(d), sourceId: carryings[c],
      });
      // A PATCH with dwellSeconds writes a `revisit` too — BUT NOT ON FIRST
      // CONTACT. A first visit is not a return, and modelling it otherwise here
      // is what made the old numbers wrong: it added 8 points, more than three
      // reads, for opening something for the first time. See carryings.service.
      if (touched.has(String(carryings[c]))) {
        await SeedEventModel.create({
          userId: user, type: "revisit", weight: 1, at: day(d), sourceId: carryings[c],
        });
      }
      touched.add(String(carryings[c]));
    }
    const seed = await computeSeed(user, day(d));
    pointsByDay.push(seed.points);
    for (const s of GROWTH_STAGE_DEFINITIONS) {
      if (seed.points >= s.threshold && firstDayAt[s.stage] === undefined) firstDayAt[s.stage] = d + 1;
    }
  }
  return { firstDayAt, pointsByDay, total: pointsByDay[6]! };
}

describe("the thresholds themselves", () => {
  it("Root is 10, and nothing else moved", () => {
    expect(thresholdOf("seed")).toBe(0);
    expect(thresholdOf("root")).toBe(10);
    expect(thresholdOf("shoot")).toBe(75);
    expect(thresholdOf("sapling")).toBe(175);
    expect(thresholdOf("branching")).toBe(500);
    expect(thresholdOf("shelter")).toBe(1000);
  });

  it("NO EVENT WEIGHT CHANGED with it", () => {
    // The Root change was a threshold change only. If a weight ever moves, it
    // should be its own decision with its own reasoning, not a side effect.
    expect(pointsForEvent("read_completed", 1)).toBe(2);
    expect(pointsForEvent("revisit", 1)).toBe(8);
    expect(pointsForEvent("action_taken", 1)).toBe(25);
    expect(pointsForEvent("premise_reframed", 1)).toBe(15);
    expect(pointsForEvent("stage_movement", 1)).toBe(20);
    expect(pointsForEvent("dwell_time", 1200)).toBe(10);
  });

  it("still rises, and Root is still below one action", () => {
    const thresholds = GROWTH_STAGE_DEFINITIONS.map((s) => s.threshold);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
    // A single action_taken must not skip a stage boundary from zero.
    expect(growthStageFor(pointsForEvent("action_taken", 1)).stage).toBe("root");
  });
});

describe("the trial week", () => {
  it("READS ONLY: seven reads cross Root on day five and stay far from Shoot", async ({ skip }) => {
    if (!connected) skip();
    // THIS IS THE ONLY PATH A REAL CLIENT CAN PRODUCE TODAY. No screen calls
    // `updateCarrying`, so nothing emits dwell_time or revisit; the carrying
    // paths below are hypothetical until the dwell timer is wired to a screen.
    // Which makes this the real trial week, not a floor.
    // The case the change exists for. Someone who does exactly the thing the
    // product is for, and touches nothing else, used to end the week on 14
    // points as a Seed — a tree that had not moved once in the only week that
    // decides whether they stay.
    const week = await trialWeek((d) => ({ read: d < 7 }));

    expect(week.total).toBe(14);
    expect(week.firstDayAt.root).toBe(5);
    expect(week.firstDayAt.shoot).toBeUndefined();
    expect(week.total).toBeLessThan(thresholdOf("shoot") / 4);
  });

  it("does not reach Root at all under the OLD threshold", () => {
    // Seven reads is 14 points. This is the whole argument for the change, and
    // it is asserted rather than described so that reverting Root to 25 without
    // reconsidering reads breaks something.
    expect(7 * pointsForEvent("read_completed", 1)).toBeLessThan(25);
    expect(7 * pointsForEvent("read_completed", 1)).toBeGreaterThan(thresholdOf("root"));
  });

  it("READS PLUS A CARRYING: Root on day two, Shoot at the very end of the week", async ({ skip }) => {
    if (!connected) skip();
    // HYPOTHETICAL. No screen calls updateCarrying, so nothing produces
    // dwell_time or revisit in a real client yet — see the note at the head of
    // the reads-only test.
    //
    // This used to total 87.5 and cross Shoot on day six, because `revisit`
    // paid 8 on FIRST CONTACT: eight points, more than three cultivation
    // reads, for opening something before anything had been left to come back
    // to. Fixed at the trigger on 2026-09-07, weight untouched.
    const week = await trialWeek((d) => ({ read: d < 7, dwellSeconds: 300 }));

    expect(week.total).toBe(79.5);
    expect(week.firstDayAt.root).toBe(2);
    expect(week.firstDayAt.shoot).toBe(7);
  });

  it("TWO CARRYINGS still reaches Sapling in a week", async ({ skip }) => {
    if (!connected) skip();
    // Also hypothetical. Worth pinning because it is the engaged path and it is
    // the one most likely to be the first thing anybody actually sees.
    const week = await trialWeek((d) => ({ read: d < 7, dwellSeconds: 600, carryings: 2 }));
    expect(week.total).toBe(180);
    expect(week.firstDayAt.shoot).toBe(4);
    expect(week.firstDayAt.sapling).toBe(7);
  });

  it("THE DEGENERATE PATH REACHES ROOT AND STOPS THERE, FOREVER", async ({ skip }) => {
    if (!connected) skip();
    // `stage_movement` was 20 points per request with no cap and no rate
    // limiter, guarded only by "not the slug you are already in" — so
    // alternating two slugs was Root in one request and Shelter in fifty.
    //
    // Now deduped once-ever on {userId, type, sourceId}, enforced by a unique
    // partial index rather than by a read-then-write check. Fifty requests a
    // day for seven days is worth exactly two entries: 40 points, and never a
    // point more.
    //
    // The failure this guards is not someone cheating. It is the metric being
    // reachable without practice at all, which would make it mean nothing.
    const carryings: mongoose.Types.ObjectId[] = [];
    void carryings;
    const stageA = new mongoose.Types.ObjectId();
    const stageB = new mongoose.Types.ObjectId();

    for (let d = 0; d < 7; d += 1) {
      for (let i = 0; i < 50; i += 1) {
        // What the SERVICE now writes: one row per virtue, ever. Modelled here
        // as the unique index refusing the rest.
        await SeedEventModel.collection
          .insertOne({
            userId: user, type: "stage_movement", weight: 1, at: day(d),
            sourceId: i % 2 === 0 ? stageA : stageB,
            createdAt: new Date(), updatedAt: new Date(),
          } as never)
          .catch(() => undefined);
      }
    }

    const seed = await computeSeed(user, day(6));
    expect(seed.eventCount).toBe(2);
    expect(seed.points).toBe(40);
    expect(seed.growthStage).toBe("root");
    // 350 requests. Shelter is 1000 and it is not remotely in reach.
    expect(seed.points).toBeLessThan(thresholdOf("shoot"));
  });
});

describe("dwell_time is bounded by a ceiling, not by a session", () => {
  it("has a per-day cap, and it holds against a request loop", async ({ skip }) => {
    if (!connected) skip();
    // The server never measures elapsed time — `dwellSeconds` is a client-
    // supplied integer and PATCH /v1/carryings/:id has no rate limiter — so the
    // daily ceiling is the only thing standing between a loop and the whole
    // arc. Twenty PATCHes of the maximum 4 hours each is 720 raw points.
    const carrying = new mongoose.Types.ObjectId();
    for (let i = 0; i < 20; i += 1) {
      await SeedEventModel.create({
        userId: user, type: "dwell_time", weight: 14_400, at: day(0), sourceId: carrying,
      });
    }
    const seed = await computeSeed(user, day(0));
    expect(SEED_DAILY_CAPS.dwell_time).toBe(20);
    expect(seed.points).toBe(20);
    expect(seed.growthStage).toBe("root");
    // Not Shoot, not Sapling. The ceiling is doing the whole job here.
    expect(seed.points).toBeLessThan(thresholdOf("shoot"));
  });
});
