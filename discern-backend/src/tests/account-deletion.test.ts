// Account deletion, against a real database.
//
// Mocks would prove nothing here. The property under test is "every collection
// the registry names is actually emptied", and the only way that can be wrong
// is if a real deleteMany does not match real rows — which is exactly what a
// mock would paper over.
//
// Runs against local mongod (setup-env points at discern-test). Skips rather
// than fails when mongod is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CarryingModel,
  ConversationModel,
  MessageModel,
  ProcessedWebhookEventModel,
  SafetyEventModel,
  SeedEventModel,
  SpeechUsageModel,
  UserMemoryModel,
  UserModel,
  UserStageModel,
} from "../models";
// Direct, not from the barrel: the journal is deliberately not re-exported.
import { JournalEntryModel } from "../models/journal-entry.model";
import { deleteAccount } from "../services/users/account-deletion.service";
import { ownedCollectionLabels } from "../services/users/account-link.service";

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
  if (connected) await mongoose.disconnect();
});

/** Gives a user one row in every registered collection. */
async function seedEverything(userId: mongoose.Types.ObjectId, tag: string) {
  const passageId = new mongoose.Types.ObjectId();
  const conversation = await ConversationModel.create({
    userId,
    mode: "text",
    startedAt: new Date(),
  });
  await Promise.all([
    CarryingModel.create({ userId, kind: "passage", refId: passageId, why: tag }),
    UserStageModel.create({
      userId,
      stageSlug: "pride-humility",
      enteredAt: new Date(),
      enteredBy: "user",
    }),
    SeedEventModel.create({ userId, type: "dwell_time", weight: 1, at: new Date() }),
    MessageModel.create({
      conversationId: conversation._id,
      userId,
      role: "user",
      content: tag,
    }),
    SafetyEventModel.create({
      userId,
      classification: "none",
      at: new Date(),
      actionTaken: "none",
      messageExcerpt: tag,
    }),
    UserMemoryModel.create({ userId, facts: [], peopleMentioned: [] }),
    ProcessedWebhookEventModel.create({
      provider: "revenuecat",
      eventId: `evt-${tag}-${Date.now()}`,
      eventType: "INITIAL_PURCHASE",
      userId,
      appUserId: `anon-${tag}`,
      revenueCatCustomerId: `rc-${tag}`,
      transactionId: `txn-${tag}-${Date.now()}`,
    }),
    SpeechUsageModel.create({
      scope: `user:${String(userId)}`,
      day: new Date().toISOString().slice(0, 10),
    }),
    // THE JOURNAL. It moved onto the server on 2026-09-06 specifically so that
    // this line could exist — the old deletion screen said the journal stayed
    // on the phone, which was true and was also a contradiction sitting in the
    // middle of a screen titled "Delete account".
    JournalEntryModel.create({
      userId,
      clientId: `cid-${tag}-${Date.now()}`,
      body: tag,
      writtenAt: new Date(),
    }),
  ]);
}

async function countsFor(userId: mongoose.Types.ObjectId) {
  return {
    carryings: await CarryingModel.countDocuments({ userId }),
    userStages: await UserStageModel.countDocuments({ userId }),
    seedEvents: await SeedEventModel.countDocuments({ userId }),
    conversations: await ConversationModel.countDocuments({ userId }),
    messages: await MessageModel.countDocuments({ userId }),
    safetyEvents: await SafetyEventModel.countDocuments({ userId }),
    userMemory: await UserMemoryModel.countDocuments({ userId }),
    webhookEventsLinked: await ProcessedWebhookEventModel.countDocuments({ userId }),
    speechUsage: await SpeechUsageModel.countDocuments({
      scope: `user:${String(userId)}`,
    }),
    journalEntries: await JournalEntryModel.countDocuments({ userId }),
    user: await UserModel.countDocuments({ _id: userId }),
  };
}

describe("account deletion", () => {
  beforeEach(async () => {
    if (!connected) return;
    await Promise.all([
      CarryingModel.deleteMany({}),
      UserStageModel.deleteMany({}),
      // Raw collection: the model refuses an unfiltered deleteMany, correctly.
      // Test teardown is not an account deletion and must not pretend to be.
      SeedEventModel.collection.deleteMany({}),
      ConversationModel.deleteMany({}),
      MessageModel.deleteMany({}),
      SafetyEventModel.deleteMany({}),
      UserMemoryModel.deleteMany({}),
      ProcessedWebhookEventModel.deleteMany({}),
      SpeechUsageModel.deleteMany({}),
      JournalEntryModel.deleteMany({}),
      UserModel.deleteMany({ deviceId: /^del-test-/ }),
    ]);
  });

  it("empties every collection the REGISTRY names", async ({ skip }) => {
    if (!connected) skip();

    const user = await UserModel.create({ deviceId: `del-test-a-${Date.now()}` });
    await seedEverything(user._id, "a");

    const before = await countsFor(user._id);
    expect(before.carryings).toBe(1);
    expect(before.user).toBe(1);

    const result = await deleteAccount(user._id);

    const after = await countsFor(user._id);
    expect(after).toEqual({
      carryings: 0,
      userStages: 0,
      seedEvents: 0,
      conversations: 0,
      messages: 0,
      safetyEvents: 0,
      userMemory: 0,
      webhookEventsLinked: 0,
      speechUsage: 0,
      journalEntries: 0,
      user: 0,
    });

    // The result reports a row for EVERY registered collection, so a collection
    // silently doing nothing is visible rather than absent.
    for (const label of ownedCollectionLabels()) {
      expect(result.removed).toHaveProperty(label);
    }
  });

  it("ANONYMISES the webhook ledger rather than deleting it", async ({ skip }) => {
    if (!connected) skip();

    const user = await UserModel.create({ deviceId: `del-test-w-${Date.now()}` });
    await seedEverything(user._id, "w");

    const result = await deleteAccount(user._id);

    // The row survives — it is the idempotency guard and the refund evidence.
    const surviving = await ProcessedWebhookEventModel.findOne({ eventType: "INITIAL_PURCHASE" });
    expect(surviving).not.toBeNull();
    // But every link back to the person is gone, and it is DETACHED, not flagged.
    expect(surviving!.userId).toBeNull();
    expect(surviving!.appUserId).toBeNull();
    expect(surviving!.revenueCatCustomerId).toBeNull();
    expect(surviving!.detachedAt).toBeInstanceOf(Date);
    expect(surviving!.transactionId).toBeTruthy();

    expect(result.retained.map((r) => r.collection)).toContain("processedWebhookEvents");
  });

  it("leaves a second user's data completely untouched", async ({ skip }) => {
    if (!connected) skip();

    const victim = await UserModel.create({ deviceId: `del-test-v-${Date.now()}` });
    const bystander = await UserModel.create({ deviceId: `del-test-b-${Date.now()}` });
    await seedEverything(victim._id, "v");
    await seedEverything(bystander._id, "b");

    await deleteAccount(victim._id);

    const after = await countsFor(bystander._id);
    expect(after).toEqual({
      carryings: 1,
      userStages: 1,
      seedEvents: 1,
      conversations: 1,
      messages: 1,
      safetyEvents: 1,
      userMemory: 1,
      webhookEventsLinked: 1,
      speechUsage: 1,
      journalEntries: 1,
      user: 1,
    });
  });

  it("is idempotent — a second call does not error", async ({ skip }) => {
    if (!connected) skip();

    const user = await UserModel.create({ deviceId: `del-test-i-${Date.now()}` });
    await seedEverything(user._id, "i");

    await deleteAccount(user._id);
    const second = await deleteAccount(user._id);

    expect(second.removed.carryings).toBe(0);
    expect(second.removed.user).toBe(0);
    expect(second.deletedAt).toBeTruthy();
  });

  it("RESUMES after a mid-run failure and finishes the job", async ({ skip }) => {
    if (!connected) skip();

    const user = await UserModel.create({ deviceId: `del-test-r-${Date.now()}` });
    await seedEverything(user._id, "r");

    // Blow up on the fourth collection, partway through the registry walk.
    const spy = vi
      .spyOn(ConversationModel, "deleteMany")
      .mockRejectedValueOnce(new Error("simulated mid-run failure"));

    await expect(deleteAccount(user._id)).rejects.toThrow("simulated mid-run failure");

    // Partially deleted: earlier collections gone, later ones and the USER left.
    const mid = await countsFor(user._id);
    expect(mid.carryings).toBe(0);
    expect(mid.conversations).toBe(1);
    expect(mid.user).toBe(1); // the account is still findable, which is the point

    spy.mockRestore();

    // The retry finishes it, without erroring on the rows already gone.
    await deleteAccount(user._id);

    const after = await countsFor(user._id);
    expect(after.conversations).toBe(0);
    expect(after.user).toBe(0);
  });

  it("works for an ANONYMOUS user with an entitlement and no account", async ({ skip }) => {
    if (!connected) skip();

    // Purchased before signing up: entitlement on the device, accountId null.
    const user = await UserModel.create({
      deviceId: `del-test-anon-${Date.now()}`,
      accountId: null,
      accountProvider: null,
      entitlement: {
        status: "active",
        expiresAt: new Date(Date.now() + 86_400_000),
        willRenew: true,
        revenueCatAppUserIds: ["$RCAnonymousID:abc123"],
        verificationState: "verified",
      },
    });
    await seedEverything(user._id, "anon");

    expect(user.accountId).toBeNull();

    const result = await deleteAccount(user._id);

    expect((await countsFor(user._id)).user).toBe(0);
    expect(result.removed.carryings).toBe(1);
  });
});
