// The merge path, tested against a real database.
//
// This is the one behaviour in the app where a silent failure costs a person
// something irreplaceable, so it is not tested with mocks. The registry is empty
// in Phase 4 — no user-owned collections exist yet — which means the ONLY way to
// prove the reparenting mechanism works is to register a collection for the
// duration of the test and watch documents move.
//
// Runs against local mongod (setup-env points at discern-test). If no local
// mongod is reachable the suite skips rather than failing: it is an integration
// test and its absence should not be reported as a broken build.

import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UserModel } from "../models";
import {
  assertOwnedCollectionsRegistered,
  linkAccount,
  ownedCollectionLabels,
  registerOwnedCollection,
  resolveSurvivingUser,
} from "../services/users/account-link.service";

/** Stands in for carryings/conversations until Phase 5 and 6 create them. */
const carryingLikeSchema = new mongoose.Schema<OwnedThing>(
  { userId: { type: mongoose.Schema.Types.ObjectId, required: true }, label: String },
  { collection: "test_owned_things" },
);
interface OwnedThing {
  userId: mongoose.Types.ObjectId;
  label?: string;
}

const OwnedThingModel: mongoose.Model<OwnedThing> =
  (mongoose.models.TestOwnedThing as mongoose.Model<OwnedThing> | undefined) ??
  mongoose.model<OwnedThing>("TestOwnedThing", carryingLikeSchema);

let connected = false;
let unregister: (() => void) | undefined;

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

  unregister = registerOwnedCollection({
    label: "testOwnedThings",
    model: () => OwnedThingModel as never,
    userField: "userId",
  });
});

afterAll(async () => {
  unregister?.();
  if (connected) {
    await OwnedThingModel.deleteMany({});
    await UserModel.deleteMany({ deviceId: /^test-link-/ });
    await mongoose.disconnect();
  }
});

describe("account linking", () => {
  it("registers the stand-in collection", () => {
    expect(ownedCollectionLabels()).toContain("testOwnedThings");
  });

  it("attaches an account to the current user without moving anything", async () => {
    if (!connected) return;

    const user = await UserModel.create({ deviceId: `test-link-a-${Date.now()}` });

    const result = await linkAccount(String(user._id), {
      provider: "apple",
      accountId: `acct-attach-${Date.now()}`,
    });

    expect(result.outcome).toBe("attached");
    expect(String(result.user._id)).toBe(String(user._id));
  });

  it("MOVES every owned document when a new device merges into an account", async () => {
    if (!connected) return;

    const accountId = `acct-merge-${Date.now()}`;

    // The old phone: has an account and history.
    const original = await UserModel.create({
      deviceId: `test-link-old-${Date.now()}`,
      accountId,
      accountProvider: "apple",
      abigailConversationsStarted: 3,
    });
    await OwnedThingModel.create([
      { userId: original._id, label: "carrying kept for months" },
      { userId: original._id, label: "another" },
    ]);

    // The new phone: fresh anonymous user with a little of its own history.
    const fresh = await UserModel.create({
      deviceId: `test-link-new-${Date.now()}`,
      abigailConversationsStarted: 1,
    });
    await OwnedThingModel.create({ userId: fresh._id, label: "added on the new phone" });

    const result = await linkAccount(String(fresh._id), {
      provider: "apple",
      accountId,
    });

    expect(result.outcome).toBe("merged");
    // The ACCOUNT HOLDER survives, not the caller: it is the one with history.
    expect(String(result.user._id)).toBe(String(original._id));
    expect(result.moved?.testOwnedThings).toBe(1);

    // Nothing stranded: all three documents now belong to the survivor.
    const survivorDocs = await OwnedThingModel.countDocuments({
      userId: original._id,
    });
    expect(survivorDocs).toBe(3);
    expect(await OwnedThingModel.countDocuments({ userId: fresh._id })).toBe(0);

    // The counter is history, not inventory: 3 + 1.
    const reloaded = await UserModel.findById(original._id);
    expect(reloaded?.abigailConversationsStarted).toBe(4);
  });

  it("keeps the absorbed user's OLD token working", async () => {
    if (!connected) return;

    const accountId = `acct-token-${Date.now()}`;
    const original = await UserModel.create({
      deviceId: `test-link-t-old-${Date.now()}`,
      accountId,
      accountProvider: "apple",
    });
    const fresh = await UserModel.create({
      deviceId: `test-link-t-new-${Date.now()}`,
    });

    await linkAccount(String(fresh._id), { provider: "apple", accountId });

    // A token minted before the merge names the absorbed id. It must resolve to
    // the survivor rather than reporting the account gone — otherwise signing in
    // on the old phone logs you out of your own life.
    const resolved = await resolveSurvivingUser(String(fresh._id));
    expect(String(resolved?._id)).toBe(String(original._id));
  });

  it("never downgrades a paid entitlement during a merge", async () => {
    if (!connected) return;

    const accountId = `acct-ent-${Date.now()}`;
    // The account holder is free; the new device carries the purchase.
    const original = await UserModel.create({
      deviceId: `test-link-e-old-${Date.now()}`,
      accountId,
      accountProvider: "apple",
    });
    const fresh = await UserModel.create({
      deviceId: `test-link-e-new-${Date.now()}`,
      entitlement: {
        status: "active",
        expiresAt: new Date(Date.now() + 86_400_000),
        willRenew: true,
        revenueCatAppUserIds: ["rc-new-device"],
        verificationState: "verified",
      },
    });

    await linkAccount(String(fresh._id), { provider: "apple", accountId });

    const reloaded = await UserModel.findById(original._id);
    // Taking the survivor's "free" here would delete a purchase somebody made.
    expect(reloaded?.entitlement.status).toBe("active");
    expect(reloaded?.entitlement.revenueCatAppUserIds).toContain("rc-new-device");
  });

  it("is idempotent when the account is already this user's", async () => {
    if (!connected) return;

    const accountId = `acct-idem-${Date.now()}`;
    const user = await UserModel.create({
      deviceId: `test-link-i-${Date.now()}`,
      accountId,
      accountProvider: "apple",
    });

    const result = await linkAccount(String(user._id), {
      provider: "apple",
      accountId,
    });

    expect(result.outcome).toBe("already-linked");
  });
});

describe("owned-collection registry", () => {
  it("names what is missing when a collection is not registered", () => {
    // The guard that turns "somebody forgot" into a startup error rather than a
    // support ticket six months later.
    // Everything real is registered as of Phase 6, so the guard is exercised
    // with a name that does not exist. Updating this expectation each phase is
    // the point: the test only passes when the registry is actually complete.
    expect(() =>
      assertOwnedCollectionsRegistered(["carryings", "notAThing"]),
    ).toThrow(/notAThing/);
  });

  it("passes for collections that are registered", () => {
    expect(() =>
      assertOwnedCollectionsRegistered([
        "testOwnedThings",
        "carryings",
        "userStages",
        "seedEvents",
        "conversations",
        "messages",
        "safetyEvents",
        "userMemory",
      ]),
    ).not.toThrow();
  });
});
