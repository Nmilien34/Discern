// The second axis.
//
// The tree has two axes and only one of them grows. `growthStage` is how far
// someone has come and only ever goes up; `vigor` is how recently they have
// tended it, and it softens the foliage's colour and NOTHING ELSE.
//
// Everything below is the same rule from a different angle: BEING AWAY MUST
// NEVER COST ANYTHING. Vigor is floored, it is not a streak, it cannot be
// farmed, and one return restores it completely.

import { describe, expect, it } from "vitest";

import {
  VIGOR_DORMANT_DAYS,
  VIGOR_FLOOR,
  VIGOR_FULL_DAYS,
  vigorFor,
} from "../config/seed-growth";
import { seedResponseSchema } from "@discern/shared";

describe("vigor", () => {
  it("a brand-new user with no events is FULL, not dormant", () => {
    // The first thing the product would otherwise say to someone who arrived an
    // hour ago is that they have neglected something.
    expect(vigorFor(null)).toBe(1);
  });

  it("is full for the whole first week", () => {
    for (const day of [0, 1, 3, 6, VIGOR_FULL_DAYS]) {
      expect(vigorFor(day), `day ${day}`).toBe(1);
    }
  });

  it("eases rather than collapses — a couple of quiet weeks is still most of it", () => {
    // The canvas draws this state at 0.68 and calls it "Easing: a couple of
    // quiet weeks. Softer — same size, same seven branches."
    const threeWeeks = vigorFor(21);
    expect(threeWeeks).toBeGreaterThan(0.6);
    expect(threeWeeks).toBeLessThan(0.75);
  });

  it("NEVER goes below the floor, however long someone is away", () => {
    for (const day of [VIGOR_DORMANT_DAYS, 60, 365, 3650, 100_000]) {
      expect(vigorFor(day), `day ${day}`).toBe(VIGOR_FLOOR);
    }
  });

  it("decreases monotonically and is continuous at both joins", () => {
    let previous = 1;
    for (let day = 0; day <= 60; day += 1) {
      const value = vigorFor(day);
      expect(value, `day ${day}`).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(VIGOR_FLOOR);
      previous = value;
    }
    // No cliff at either end of the ramp.
    expect(vigorFor(VIGOR_FULL_DAYS + 1)).toBeLessThan(1);
    expect(vigorFor(VIGOR_FULL_DAYS + 1)).toBeGreaterThan(0.95);
    expect(vigorFor(VIGOR_DORMANT_DAYS - 1)).toBeGreaterThan(VIGOR_FLOOR);
  });

  it("IS NOT A STREAK: one return after eight months restores it completely", () => {
    // A streak counts consecutive days and is lost by missing one. This is a
    // function of a single number, so there is nothing to break and nothing to
    // re-earn. Come back and it is full the same day.
    expect(vigorFor(240)).toBe(VIGOR_FLOOR);
    expect(vigorFor(0)).toBe(1);
  });

  it("rounds to two places, so a client's render cache does not miss every time", () => {
    for (let day = 0; day <= 40; day += 1) {
      const value = vigorFor(day);
      expect(Math.round(value * 100) / 100, `day ${day}`).toBe(value);
    }
  });
});

describe("the floor is in the contract, not only in the code", () => {
  const base = {
    growthStage: "sapling" as const,
    growthStageLabel: "Sapling",
    growthStageDescription: "x",
    points: 200,
    nextStage: "branching" as const,
    pointsToNextStage: 300,
    progressInStage: 0.1,
    eventCount: 4,
    contributions: [],
    firstEventAt: null,
    lastEventAt: null,
  };

  it("accepts the floor and full vigor", () => {
    expect(seedResponseSchema.safeParse({ ...base, vigor: VIGOR_FLOOR }).success).toBe(true);
    expect(seedResponseSchema.safeParse({ ...base, vigor: 1 }).success).toBe(true);
  });

  it("REFUSES to describe a dying tree", () => {
    // The design rule — never grey, never bare, never dropping leaves — is
    // enforced by the type. A handler that computed 0.2 would throw in
    // development rather than render a tree that looks like it is failing.
    for (const vigor of [0, 0.1, 0.41, -1]) {
      expect(seedResponseSchema.safeParse({ ...base, vigor }).success, `vigor ${vigor}`).toBe(false);
    }
    expect(seedResponseSchema.safeParse({ ...base, vigor: 1.2 }).success).toBe(false);
  });

  it("requires it — a response that forgot the second axis does not parse", () => {
    expect(seedResponseSchema.safeParse(base).success).toBe(false);
  });
});

// ── AND THE SAME THING END TO END ───────────────────────────────────────────
//
// The unit tests above prove the curve. This proves the WIRING: that
// computeSeed actually finds the last event, measures from it, and puts the
// number in the response — and that the stage axis is untouched by any of it.
//
// Own database, because account-deletion.test.ts wipes collections wholesale
// and vitest runs files in parallel. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { SeedEventModel, UserModel } from "../models";
import { computeSeed } from "../services/journey/seed.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-vigor`,
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

const NOW = new Date("2026-09-06T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let user: mongoose.Types.ObjectId;

beforeEach(async () => {
  if (!connected) return;
  await SeedEventModel.collection.deleteMany({});
  await UserModel.deleteMany({ deviceId: /^vig-test-/ });
  user = (await UserModel.create({ deviceId: `vig-test-${Date.now()}` }))._id;
});

describe("computeSeed puts the second axis in the response", () => {
  it("is full for someone who has never done anything", async ({ skip }) => {
    if (!connected) skip();
    const seed = await computeSeed(user, NOW);
    expect(seed.vigor).toBe(1);
    expect(seed.eventCount).toBe(0);
    expect(seed.growthStage).toBe("seed");
  });

  it("is full through a week and eased after a month", async ({ skip }) => {
    if (!connected) skip();

    await SeedEventModel.create({ userId: user, type: "revisit", weight: 1, at: daysAgo(3) });
    expect((await computeSeed(user, NOW)).vigor).toBe(1);

    await SeedEventModel.collection.deleteMany({});
    await SeedEventModel.create({ userId: user, type: "revisit", weight: 1, at: daysAgo(40) });
    expect((await computeSeed(user, NOW)).vigor).toBe(VIGOR_FLOOR);
  });

  it("BEING AWAY COSTS NOTHING: the same points, the same stage, months later", async ({ skip }) => {
    if (!connected) skip();

    // Someone who practised hard and then disappeared for eight months.
    for (let i = 0; i < 30; i += 1) {
      await SeedEventModel.create({
        userId: user,
        type: "revisit",
        weight: 1,
        at: daysAgo(240 + i),
      });
    }

    const away = await computeSeed(user, NOW);
    const asIfToday = await computeSeed(user, daysAgo(239));

    // The colour has faded to the floor...
    expect(away.vigor).toBe(VIGOR_FLOOR);
    expect(asIfToday.vigor).toBe(1);
    // ...and NOTHING ELSE MOVED. Not the points, not the stage, not the
    // progress. There is no decay and no absence penalty, and this is the test
    // that would fail if somebody ever added one.
    expect(away.points).toBe(asIfToday.points);
    expect(away.growthStage).toBe(asIfToday.growthStage);
    expect(away.progressInStage).toBe(asIfToday.progressInStage);
    expect(away.eventCount).toBe(asIfToday.eventCount);
  });

  it("one return greens it completely, the same day", async ({ skip }) => {
    if (!connected) skip();

    await SeedEventModel.create({ userId: user, type: "revisit", weight: 1, at: daysAgo(300) });
    expect((await computeSeed(user, NOW)).vigor).toBe(VIGOR_FLOOR);

    // They come back and sit with one passage.
    await SeedEventModel.create({ userId: user, type: "dwell_time", weight: 600, at: NOW });
    const back = await computeSeed(user, NOW);
    expect(back.vigor).toBe(1);
    // And it was ADDED to what they had, never re-earned.
    expect(back.points).toBeGreaterThan(8);
  });
});
