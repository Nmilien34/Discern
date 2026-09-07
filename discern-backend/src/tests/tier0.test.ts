// Tier 0 — the five small things that unblock four tabs.
//
// Nothing here is architectural. The audit found the API surface complete and
// the gaps to be fields and small endpoints, and these are the tests for those.
//
// Own database. Skips when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  meResponseSchema,
  memoryResponseSchema,
  onboardingAnswersSchema,
  speechAllowanceResponseSchema,
  updatePreferencesRequestSchema,
} from "@discern/shared";
import { UserMemoryModel, UserModel } from "../models";
import { forgetMemory, readMemory } from "../services/users/memory.service";
import { resolveStartingStage } from "../services/journey/availability.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-tier0`,
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

beforeEach(async () => {
  if (!connected) return;
  await Promise.all([
    UserMemoryModel.deleteMany({}),
    UserModel.deleteMany({ deviceId: /^t0-/ }),
  ]);
  user = (await UserModel.create({ deviceId: `t0-${Date.now()}` }))._id;
});

describe("1. onboarding answers", () => {
  it("has somewhere to go at all — the whole gap", () => {
    // `POST /v1/me/onboarding` accepted `{ step }` and nothing else, so ten
    // questions were asked and one and a half were stored.
    const parsed = onboardingAnswersSchema.safeParse({
      name: "Nick",
      brought: "keep-doing-it",
      vices: ["pride-humility", "wrath-patience"],
      firstVice: "pride-humility",
      situation: "I keep rehearsing it.",
      person: "Sam",
      familiarity: "assume-i-know",
      timeAvailable: "about-twenty",
    });
    expect(parsed.success).toBe(true);
  });

  it("stores SLUGS, not the copy on the screen", () => {
    // Screen 4's options are full sentences. Storing sentences means a wording
    // change silently invalidates every answer already given.
    expect(onboardingAnswersSchema.safeParse({ brought: "keep-doing-it" }).success).toBe(true);
    expect(
      onboardingAnswersSchema.safeParse({
        brought: "I keep doing the thing I said I'd stop doing",
      }).success,
    ).toBe(false);
  });

  it("ACCUMULATES — a later screen cannot clear an earlier answer", async ({ skip }) => {
    if (!connected) skip();
    // Screen 3 writes a name. Screen 6 writes vices and says nothing about the
    // name. This is what makes quitting at screen 9 and returning work.
    await UserModel.updateOne({ _id: user }, { $set: { "onboardingAnswers.name": "Nick", name: "Nick" } });
    await UserModel.updateOne({ _id: user }, { $set: { "onboardingAnswers.vices": ["pride-humility"] } });

    const after = await UserModel.findById(user).lean();
    expect(after!.onboardingAnswers.name).toBe("Nick");
    expect(after!.onboardingAnswers.vices).toEqual(["pride-humility"]);
    expect(after!.name).toBe("Nick");
  });

  it("every field is optional, because every screen writes only what it has", () => {
    expect(onboardingAnswersSchema.safeParse({}).success).toBe(true);
    expect(onboardingAnswersSchema.safeParse({ name: "Nick" }).success).toBe(true);
  });

  it("the selection feeds a resolver that already existed", async ({ skip }) => {
    if (!connected) skip();
    // The vice -> virtue map was never the gap. STAGE_SLUGS already pairs them
    // and this function already returns start / choose / nothing-available.
    // The only thing missing was that the answer was never written down.
    const decision = await resolveStartingStage(["pride-humility"]);
    expect(["start", "choose", "nothing-available"]).toContain(decision.kind);
  });
});

describe("2. what she remembers", () => {
  it("returns open threads WITH a way back in", async ({ skip }) => {
    if (!connected) skip();
    const conversationId = new mongoose.Types.ObjectId();
    await UserMemoryModel.create({
      userId: user,
      facts: [{ text: "he works nights", at: new Date(), source: "stated" }],
      peopleMentioned: [{ name: "Sam", relationship: "brother", context: "the one he has not called" }],
      openThreads: [{ text: "the conversation he has not had", at: new Date(), conversationId }],
    });

    const memory = await readMemory(user);
    expect(memory.openThreads[0]!.conversationId).toBe(String(conversationId));
    expect(memoryResponseSchema.safeParse(memory).success).toBe(true);
  });

  it("is HONEST about a thread with no conversation, rather than hiding it", async ({ skip }) => {
    if (!connected) skip();
    // Threads written before 2026-09-07 have none and are not backfilled: the
    // nightly job replaces openThreads wholesale, so they are rewritten within
    // a day and a backfill would be guesswork with a shelf life of hours. The
    // client renders text with no way in, which is what it is.
    await UserMemoryModel.create({
      userId: user,
      facts: [], peopleMentioned: [],
      openThreads: [{ text: "written before the field existed", at: new Date() }],
    });
    const memory = await readMemory(user);
    expect(memory.openThreads).toHaveLength(1);
    expect(memory.openThreads[0]!.conversationId).toBeNull();
  });

  it("lists the vice selection, which round 15 ruled sensitive", async ({ skip }) => {
    if (!connected) skip();
    await UserModel.updateOne({ _id: user }, { $set: { "onboardingAnswers.vices": ["pride-humility"] } });
    await UserMemoryModel.create({ userId: user, facts: [], peopleMentioned: [], openThreads: [] });
    expect((await readMemory(user)).vices).toEqual(["pride-humility"]);
  });

  it("FORGETS a thing, and the removal reaches what the prompt builder reads", async ({ skip }) => {
    if (!connected) skip();
    await UserMemoryModel.create({
      userId: user, peopleMentioned: [], openThreads: [],
      facts: [
        { text: "first", at: new Date(), source: "stated" },
        { text: "second", at: new Date(), source: "stated" },
      ],
    });

    expect(await forgetMemory(user, "fact", "0")).toBe(true);
    const after = await UserMemoryModel.findOne({ userId: user }).lean();
    // Gone from the document itself, not flagged beside it.
    expect(after!.facts).toHaveLength(1);
    expect(after!.facts[0]!.text).toBe("second");
  });

  it("a stale index is `deleted: false`, not an error", async ({ skip }) => {
    if (!connected) skip();
    // The nightly job may have rewritten the list since the client read it.
    // That is a stale view, not a failure.
    await UserMemoryModel.create({ userId: user, facts: [], peopleMentioned: [], openThreads: [] });
    expect(await forgetMemory(user, "fact", "7")).toBe(false);
  });
});

describe("3, 4, 5. the three small ones", () => {
  it("the allowance response is information, and says what is left", () => {
    const ok = speechAllowanceResponseSchema.safeParse({
      day: "2026-09-07",
      scopes: [],
      charactersUsedToday: 12_000,
      charactersPerDay: 40_000,
      charactersRemaining: 28_000,
      voiceEnabled: true,
    });
    expect(ok.success).toBe(true);
  });

  it("preferences PATCH refuses an empty body", () => {
    // Settings and onboarding screen 13 share this endpoint. An empty write is
    // a client bug, not a no-op worth accepting.
    expect(updatePreferencesRequestSchema.safeParse({}).success).toBe(false);
    expect(updatePreferencesRequestSchema.safeParse({ typeSize: "large" }).success).toBe(true);
    expect(updatePreferencesRequestSchema.safeParse({ typeSize: "enormous" }).success).toBe(false);
  });

  it("`/v1/me` carries the name and the growth stage a lapsed subscriber needs", () => {
    // Settings opens with the glyph and has RESTORE PURCHASES on it, so the
    // person most likely to open it cannot call the gated journey routes.
    const shape = meResponseSchema.shape;
    expect("name" in shape).toBe(true);
    expect("growthStage" in shape).toBe(true);
    expect("growthStageLabel" in shape).toBe(true);
    expect("onboardingAnswers" in shape).toBe(true);
  });
});
