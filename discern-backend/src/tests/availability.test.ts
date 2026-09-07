// Content availability, and the assignment rule that depends on it.
//
// THE FAILURE THIS PREVENTS: the launch plan is two virtues written and five
// not. Onboarding asks which of the seven vices has been loudest; the
// reflection screen then names the person's virtue and the TITLE of their first
// read, and the paywall repeats it. Without a derived availability, five out of
// seven people are promised a read that does not exist, immediately before
// being asked to pay.
//
// So the assertions that matter are not "the query works". They are:
//   - all seven stages are ALWAYS returned, including the empty ones
//   - `firstReadTitle` is null when there is nothing to name, so a surface that
//     interpolates it cannot render a broken promise
//   - somebody who selected only unwritten virtues is ASKED, not assigned
//
// Runs against local mongod. Skips rather than fails when it is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { STAGE_SLUGS } from "@discern/shared";
import type { StageSlug } from "@discern/shared";

import { CultivationReadModel } from "../models";
import {
  availableStages,
  resolveStartingStage,
  stageAvailability,
} from "../services/journey/availability.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: process.env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 1500,
    });
    connected = true;
  } catch {
    connected = false;
  }
});

afterAll(async () => {
  if (connected) {
    await CultivationReadModel.deleteMany({});
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (connected) await CultivationReadModel.deleteMany({});
});

/** Publishes `count` reads into `stage`. `publishedAt: null` writes drafts. */
async function publish(stage: StageSlug, count: number, publishedAt: Date | null = new Date()) {
  for (let i = 1; i <= count; i += 1) {
    await CultivationReadModel.create({
      stageSlug: stage,
      order: i,
      type: i === 1 ? "teaching" : "example",
      title: `${stage} read ${i}`,
      runtimeSeconds: 300,
      body: ["one", "two"],
      passages: [{ reference: "Luke 14:10-11", runtimeSeconds: 24 }],
      action: i === 1 ? "Go and say it out loud." : null,
      publishedAt,
    });
  }
}

describe("content availability", () => {
  it("ALL SEVEN available", async ({ skip }) => {
    if (!connected) skip();
    for (const s of STAGE_SLUGS) await publish(s, 9);

    const all = await stageAvailability();
    expect(Object.keys(all)).toHaveLength(7);
    for (const s of STAGE_SLUGS) {
      expect(all[s].available).toBe(true);
      expect(all[s].readCount).toBe(9);
      expect(all[s].firstReadTitle).toBe(`${s} read 1`);
    }
    expect(await availableStages()).toEqual([...STAGE_SLUGS]);
  });

  it("TWO available — the launch shape — and the other five are present, not missing", async ({
    skip,
  }) => {
    if (!connected) skip();
    await publish("pride-humility", 9);
    await publish("wrath-patience", 9);

    const all = await stageAvailability();

    // Every one of the seven comes back. The "which is loudest" screen shows
    // all seven, so filtering here would make that screen impossible.
    expect(Object.keys(all)).toHaveLength(7);
    expect(await availableStages()).toEqual(["pride-humility", "wrath-patience"]);

    for (const s of STAGE_SLUGS) {
      const ready = s === "pride-humility" || s === "wrath-patience";
      expect(all[s].available).toBe(ready);
      expect(all[s].readCount).toBe(ready ? 9 : 0);
      // THE LOAD-BEARING ASSERTION. Null when there is nothing to name, so the
      // reflection screen and the paywall cannot interpolate a broken promise.
      expect(all[s].firstReadTitle).toBe(ready ? `${s} read 1` : null);
    }
  });

  it("ONE available", async ({ skip }) => {
    if (!connected) skip();
    await publish("pride-humility", 3);

    expect(await availableStages()).toEqual(["pride-humility"]);
    const all = await stageAvailability();
    expect(all["pride-humility"].readCount).toBe(3);
    expect(all["envy-gratitude"].firstReadTitle).toBeNull();
  });

  it("a DRAFTED virtue is not available, and neither is one published in the future", async ({
    skip,
  }) => {
    if (!connected) skip();
    await publish("pride-humility", 4, null); // written, not live
    await publish("wrath-patience", 4, new Date(Date.now() + 86_400_000)); // staged
    await publish("envy-gratitude", 4); // live

    expect(await availableStages()).toEqual(["envy-gratitude"]);
  });
});

describe("the assignment rule", () => {
  it("starts them on THEIR choice when it has content", async ({ skip }) => {
    if (!connected) skip();
    await publish("pride-humility", 9);
    await publish("wrath-patience", 9);

    const d = await resolveStartingStage(["wrath-patience", "pride-humility"]);
    expect(d).toEqual({ kind: "start", stageSlug: "wrath-patience" });
  });

  it("picks the first of THEIRS that is ready, not the first that is alphabetical", async ({
    skip,
  }) => {
    if (!connected) skip();
    await publish("pride-humility", 9);
    await publish("wrath-patience", 9);

    // They tapped lust first (unwritten), then wrath. Selection order wins.
    const d = await resolveStartingStage(["lust-pure-love", "wrath-patience"]);
    expect(d).toEqual({ kind: "start", stageSlug: "wrath-patience" });
  });

  it("ASKS when they selected ONLY unavailable virtues — never assigns arbitrarily", async ({
    skip,
  }) => {
    if (!connected) skip();
    await publish("pride-humility", 9);
    await publish("wrath-patience", 9);

    const d = await resolveStartingStage(["lust-pure-love", "sloth-diligence"]);

    expect(d.kind).toBe("choose");
    if (d.kind !== "choose") return;
    // What they may start on now…
    expect(d.offer).toEqual(["pride-humility", "wrath-patience"]);
    // …and what they actually named, kept so the screen can say plainly that
    // the one they chose is being written rather than silently dropping it.
    expect(d.named).toEqual(["lust-pure-love", "sloth-diligence"]);
  });

  it("names the state where nothing at all is published", async ({ skip }) => {
    if (!connected) skip();

    const d = await resolveStartingStage(["pride-humility"]);
    expect(d).toEqual({ kind: "nothing-available", named: ["pride-humility"] });
  });
});
