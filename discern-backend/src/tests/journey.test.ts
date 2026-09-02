import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GROWTH_STAGE_DEFINITIONS,
  growthStageFor,
  nextGrowthStageAfter,
  pointsForEvent,
  REVISITS_PER_CARRYING_PER_DAY,
  SEED_DAILY_CAPS,
  SEED_EVENT_WEIGHTS,
} from "../config/seed-growth";
import { SeedEventModel } from "../models";
import { checkGrounding } from "../services/abigail/grounding";

describe("the growth curve", () => {
  it("pays returning far more than volume", () => {
    // The stated requirement: someone who sits with one passage four times must
    // be further along than someone who collects twelve.
    //
    // Collecting is not an event type AT ALL, so twelve additions earn exactly
    // zero. That is the strongest possible form of the rule — there is nothing
    // to tune, because there is nothing to award.
    const fourRevisits =
      4 * pointsForEvent("revisit", 1) +
      4 * pointsForEvent("dwell_time", 300); // five minutes each

    const twelveCollected = 0;

    expect(fourRevisits).toBeGreaterThan(twelveCollected);
    expect(fourRevisits).toBeGreaterThan(30);
  });

  it("caps a single event so one long session cannot outrun months of returning", () => {
    const threeHours = pointsForEvent("dwell_time", 10_800);
    const twentyMinutes = pointsForEvent("dwell_time", 1_200);

    expect(threeHours).toBe(SEED_EVENT_WEIGHTS.dwell_time.cap);
    expect(threeHours).toBe(twentyMinutes);
  });

  it("pays most for the practice that leaves the app", () => {
    // action_taken is going and doing the human thing (Matthew 5:23-24). An app
    // about formation should reward that above anything done inside it.
    const action = pointsForEvent("action_taken", 1);

    expect(action).toBeGreaterThan(pointsForEvent("revisit", 1));
    expect(action).toBeGreaterThan(pointsForEvent("premise_reframed", 1));
    expect(action).toBeGreaterThan(pointsForEvent("conversation_depth", 20));
  });

  it("has no event type that rewards opening the app", () => {
    const types = Object.keys(SEED_EVENT_WEIGHTS);
    expect(types).not.toContain("app_opened");
    expect(types).not.toContain("daily_open");
    expect(types).not.toContain("streak");
  });

  it("never awards negative points, so nothing can shrink", () => {
    // No decay, no absence penalty — stated as a property rather than a comment.
    for (const type of Object.keys(SEED_EVENT_WEIGHTS)) {
      expect(
        pointsForEvent(type as keyof typeof SEED_EVENT_WEIGHTS, 0),
      ).toBeGreaterThanOrEqual(0);
      expect(
        pointsForEvent(type as keyof typeof SEED_EVENT_WEIGHTS, -50),
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it("starts at seed and ends at shelter, and does not loop", () => {
    // Matthew 13:31-32: the arc ends in a tree where birds lodge, not a bigger
    // seed. There is no prestige tier after shelter.
    expect(growthStageFor(0).stage).toBe("seed");
    expect(growthStageFor(100_000).stage).toBe("shelter");
    expect(nextGrowthStageAfter("shelter")).toBeNull();
  });

  it("has strictly increasing thresholds", () => {
    for (let i = 1; i < GROWTH_STAGE_DEFINITIONS.length; i += 1) {
      expect(GROWTH_STAGE_DEFINITIONS[i]!.threshold).toBeGreaterThan(
        GROWTH_STAGE_DEFINITIONS[i - 1]!.threshold,
      );
    }
  });
});

describe("the ledger is append-only", () => {
  let connected = false;
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    try {
      await mongoose.connect(
        process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/discern-test",
        { serverSelectionTimeoutMS: 2500 },
      );
      connected = true;
    } catch {
      connected = false;
    }
  });

  afterAll(async () => {
    if (connected) await mongoose.disconnect();
  });

  it("refuses to change what an event was worth", async () => {
    if (!connected) return;

    await SeedEventModel.create({ userId, type: "revisit", weight: 1 });

    await expect(
      SeedEventModel.updateMany({ userId }, { $set: { weight: 999 } }),
    ).rejects.toThrow(/APPEND-ONLY/);
  });

  it("refuses to delete history", async () => {
    if (!connected) return;

    await expect(SeedEventModel.deleteMany({ userId })).rejects.toThrow(
      /APPEND-ONLY/,
    );
  });

  it("PERMITS reparenting userId, because an account merge is not a rewrite", async () => {
    if (!connected) return;

    // Found by the Phase 4 merge test the moment seedEvents was registered as
    // user-owned: a blanket refusal here strands the ledger on the old phone,
    // which is the seed silently shrinking to zero.
    const result = await SeedEventModel.updateMany(
      { userId },
      { $set: { userId: otherUserId } },
    );

    expect(result.modifiedCount).toBeGreaterThan(0);

    // Cleanup has to go around the guard, which is the guard working.
    await SeedEventModel.collection.deleteMany({
      userId: { $in: [userId, otherUserId] },
    });
  });
});

describe("passive events are not farmable", () => {
  it("caps dwell_time per day, so a request loop cannot buy the arc", () => {
    // 100 PATCHes of 20 minutes each = 1000 raw points before capping.
    const raw = 100 * pointsForEvent("dwell_time", 1200);
    expect(raw).toBe(1000);
    expect(SEED_DAILY_CAPS.dwell_time).toBeLessThan(raw);
  });

  it("counts a revisit once per carrying per day", () => {
    // "Returning" means coming back later, not tapping twice in a session.
    expect(REVISITS_PER_CARRYING_PER_DAY).toBe(1);
  });

  it("leaves the ACTIVE types uncapped", () => {
    // These cannot be produced by clicking, and someone who genuinely repaired
    // two relationships in one day should be credited for both.
    expect(SEED_DAILY_CAPS.action_taken).toBeUndefined();
    expect(SEED_DAILY_CAPS.premise_reframed).toBeUndefined();
    expect(SEED_DAILY_CAPS.stage_movement).toBeUndefined();
  });

  it("puts Shelter about a year out, not two months", () => {
    // An engaged week is ~65-70 points.
    const shelter = GROWTH_STAGE_DEFINITIONS.at(-1)!.threshold;
    expect(shelter).toBe(1000);
    expect(shelter / 67).toBeGreaterThan(12);
  });
});

describe("the grounding check", () => {
  it("accepts a single verse quoted from inside a retrieved passage", () => {
    // The bug that made 14 of 20 eval turns fall back: "Psalm 42:5" vs the
    // stored "Psalms 42:1-11" — singular/plural AND range containment, both
    // missed by string prefix matching.
    expect(
      checkGrounding({
        reply: "x ".repeat(30) + "as it says in Psalm 42:5, hope in God.",
        retrievedReferences: ["Psalms 42:1-11"],
        toolCallCount: 1,
      }).grounded,
    ).toBe(true);
  });

  it("still catches a reference no tool returned", () => {
    const verdict = checkGrounding({
      reply: "x ".repeat(30) + "Philippians 4:19 says God will supply every need.",
      retrievedReferences: ["Psalms 42:1-11"],
      toolCallCount: 1,
    });
    expect(verdict.grounded).toBe(false);
    expect(verdict.uncitedReferences.join()).toMatch(/Philippians/i);
  });

  it("fails a substantive reply that called no tool at all", () => {
    expect(
      checkGrounding({
        reply: "x ".repeat(40),
        retrievedReferences: [],
        toolCallCount: 0,
      }).grounded,
    ).toBe(false);
  });
});

describe("grounding requires her to actually land on scripture", () => {
  it("fails a substantive reply that cites nothing", () => {
    // The failure the first version missed entirely: she called tools, invented
    // nothing, and deferred the passage to "next time". Technically honest, and
    // a violation of the one rule she has.
    const verdict = checkGrounding({
      reply:
        "I won't tell you it's going to be okay. " +
        "x ".repeat(40) +
        "When you come back, I can bring you a passage to carry.",
      retrievedReferences: ["Psalms 42:1-11"],
      toolCallCount: 3,
    });
    expect(verdict.grounded).toBe(false);
    expect(verdict.reason).toMatch(/cited no passage/i);
  });
});
