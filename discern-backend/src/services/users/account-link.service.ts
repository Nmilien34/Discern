// Attaching a durable account to a device, and merging when one already exists.
//
// THIS IS THE FILE THAT MUST NOT LOSE ANYTHING.
//
// The situation it exists for: someone has been using Discern anonymously on one
// phone. They have carryings they return to, conversations Abigail remembers,
// and a seed grown from months of practice. They get a new phone. The new phone
// launches, registers a NEW anonymous user, and then they sign in.
//
// If linking simply attached the account to the new device's user, everything on
// the old one would be stranded behind an id nobody can reach any more. Nothing
// would error. The user would just open the app and find their life with the
// text gone.
//
// So linking has two paths:
//
//   ATTACH  no user holds this account identity yet -> claim it on the CURRENT
//           user. Nothing moves. This is the first-device case.
//   MERGE   another user already holds it -> that user is the survivor, every
//           document owned by the current user is REPARENTED to it, and the
//           current user is marked as merged so its token still resolves.
//
// The survivor is the ACCOUNT holder, not the caller, because the account holder
// is the one with history. A fresh device has, by definition, nothing to lose.

import type { LinkProvider } from "@discern/shared";
import mongoose from "mongoose";
import type { Model, Types } from "mongoose";

import { ConflictError, NotFoundError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { UserDocument } from "../../models";
import {
  CarryingModel,
  ConversationModel,
  MessageModel,
  SafetyEventModel,
  SeedEventModel,
  UserMemoryModel,
  UserModel,
  UserStageModel,
} from "../../models";

/**
 * EVERY COLLECTION THAT BELONGS TO A USER MUST BE REGISTERED HERE.
 *
 * This list is the whole safety property. A merge moves exactly what this array
 * names, so a collection added in a later phase and NOT added here is silently
 * left behind — and the failure is invisible until a real person changes phone
 * and finds their carryings gone.
 *
 * Phase 5 adds: carryings, userStage, seedEvents.
 * Phase 6 adds: conversations, messages (via conversation), userMemory,
 *               safetyEvents.
 *
 * `userField` is named rather than assumed, because not every collection will
 * call it `userId`.
 */
export interface OwnedCollection {
  label: string;
  model: () => Model<unknown>;
  userField: string;
  /**
   * Resolves UNIQUE-INDEX CONFLICTS before the reparent.
   *
   * Reparenting is an updateMany, so any partial unique index scoped to userId
   * turns "both devices did this" into E11000 and the ENTIRE MERGE FAILS —
   * leaving the person signed in to an account that does not have their life in
   * it. Found by running the real Phase 5 flow: both phones had an open stage,
   * and `{userId, closedAt: null}` unique rejected the move.
   *
   * A collection with no userId-scoped unique index does not need one of these.
   */
  reconcile?: (
    fromUserId: Types.ObjectId,
    toUserId: Types.ObjectId,
  ) => Promise<number>;
}

const OWNED_COLLECTIONS: OwnedCollection[] = [
  // Phase 5. Each of these was registered as it was created, not afterwards.
  {
    label: "carryings",
    // Lazily resolved: this module is imported by middleware that loads before
    // the model registry is complete.
    model: () => CarryingModel as never,
    userField: "userId",
    reconcile: reconcileCarryings,
  },
  {
    label: "userStages",
    model: () => UserStageModel as never,
    userField: "userId",
    reconcile: reconcileUserStages,
  },
  {
    label: "seedEvents",
    model: () => SeedEventModel as never,
    userField: "userId",
  },
  // Phase 6. Registered as each model was created, not afterwards.
  {
    label: "conversations",
    model: () => ConversationModel as never,
    userField: "userId",
  },
  {
    // Messages carry userId directly rather than only conversationId, precisely
    // so this line is possible without the merge learning to walk relationships.
    label: "messages",
    model: () => MessageModel as never,
    userField: "userId",
  },
  {
    label: "safetyEvents",
    model: () => SafetyEventModel as never,
    userField: "userId",
  },
  {
    // UNIQUE on userId. Both phones will have a memory, so without the
    // reconcile this is the Phase 5 E11000 all over again — and the merge
    // failing means Abigail forgets everything she knew about someone.
    label: "userMemory",
    model: () => UserMemoryModel as never,
    userField: "userId",
    reconcile: reconcileUserMemory,
  },
];

/**
 * At most one stage may be open per user, so two open stages cannot both move.
 *
 * The MOST RECENTLY ENTERED one survives, because that is where the person
 * actually is now — they just entered it on the phone in their hand. The other
 * is CLOSED rather than deleted: it stays in history, which is the whole point
 * of keeping a stage history at all.
 */
async function reconcileUserStages(
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<number> {
  const open = await UserStageModel.find({
    userId: { $in: [fromUserId, toUserId] },
    closedAt: null,
  }).sort({ enteredAt: -1 });

  if (open.length <= 1) return 0;

  // Index 0 is the newest and survives; everything else closes.
  const closing = open.slice(1);

  for (const stage of closing) {
    stage.closedAt = new Date();
    await stage.save();
  }

  return closing.length;
}

/**
 * The same passage cannot be actively carried twice by one person.
 *
 * When both phones carry it, the SURVIVOR'S record is kept and the incoming
 * duplicate is folded into it — dwell time summed, revisits summed, notes
 * appended — and then released. Nothing is discarded: the minutes someone spent
 * with a passage on their old phone are exactly the history this app exists to
 * keep, and dropping the duplicate row would delete them.
 */
async function reconcileCarryings(
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<number> {
  const incoming = await CarryingModel.find({
    userId: fromUserId,
    releasedAt: null,
  });

  let folded = 0;

  for (const candidate of incoming) {
    const existing = await CarryingModel.findOne({
      userId: toUserId,
      kind: candidate.kind,
      refId: candidate.refId,
      releasedAt: null,
    });

    if (!existing) continue;

    existing.totalDwellSeconds += candidate.totalDwellSeconds;
    existing.revisitCount += candidate.revisitCount;
    existing.notes.push(...candidate.notes);
    if (
      candidate.lastVisitedAt &&
      (!existing.lastVisitedAt || candidate.lastVisitedAt > existing.lastVisitedAt)
    ) {
      existing.lastVisitedAt = candidate.lastVisitedAt;
    }
    await existing.save();

    // Released, not deleted — it still reparents below and stays in history.
    candidate.releasedAt = new Date();
    await candidate.save();
    folded += 1;
  }

  return folded;
}

/**
 * One memory per user, so two cannot both move.
 *
 * MERGED RATHER THAN CHOSEN. Picking a winner would throw away half of what
 * Abigail knows about somebody — the facts they told her on the old phone, the
 * people they mentioned, and above all , which is what stops her
 * handing over the same verse twice. Lists are concatenated and de-duplicated;
 * the survivor keeps everything from both.
 */
async function reconcileUserMemory(
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<number> {
  const incoming = await UserMemoryModel.findOne({ userId: fromUserId });
  if (!incoming) return 0;

  const existing = await UserMemoryModel.findOne({ userId: toUserId });
  if (!existing) return 0; // No conflict; the plain reparent below handles it.

  const byKey = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const k = key(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  existing.facts = byKey(
    [...existing.facts, ...incoming.facts],
    (f) => f.text.toLowerCase(),
  );
  existing.peopleMentioned = byKey(
    [...existing.peopleMentioned, ...incoming.peopleMentioned],
    (p) => p.name.toLowerCase(),
  );
  existing.passagesGiven = byKey(
    [...existing.passagesGiven, ...incoming.passagesGiven],
    (p) => p.ref,
  );
  existing.openThreads = byKey(
    [...existing.openThreads, ...incoming.openThreads],
    (t) => t.text.toLowerCase(),
  );

  await existing.save();

  // Removed only after its contents are safely inside the survivor.
  await UserMemoryModel.deleteOne({ _id: incoming._id });

  return 1;
}

/** Test seam: lets the merge be exercised before Phase 5 creates real content. */
export function registerOwnedCollection(entry: OwnedCollection): () => void {
  OWNED_COLLECTIONS.push(entry);
  return () => {
    const index = OWNED_COLLECTIONS.indexOf(entry);
    if (index >= 0) OWNED_COLLECTIONS.splice(index, 1);
  };
}

export function ownedCollectionLabels(): string[] {
  return OWNED_COLLECTIONS.map((entry) => entry.label);
}

export interface LinkResult {
  user: UserDocument;
  outcome: "attached" | "merged" | "already-linked";
  moved?: Record<string, number>;
}

/**
 * Follows `mergedIntoUserId` to the surviving account.
 *
 * A token minted before a merge still names the absorbed user, and that token is
 * valid until it expires. Resolving through the pointer is what stops "you
 * signed in on your old phone" from meaning "your account is gone".
 */
export async function resolveSurvivingUser(
  userId: string | Types.ObjectId,
): Promise<UserDocument | null> {
  let current = await UserModel.findById(userId);
  const seen = new Set<string>();

  while (current?.mergedIntoUserId) {
    const id = String(current._id);
    if (seen.has(id)) {
      // A cycle should be impossible, and would be unrecoverable at request
      // time. Fail loudly rather than spinning.
      logger.error({ userId: id }, "merge pointer cycle detected");
      return current;
    }
    seen.add(id);
    current = await UserModel.findById(current.mergedIntoUserId);
  }

  return current;
}

async function moveOwnedDocuments(
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};

  for (const entry of OWNED_COLLECTIONS) {
    // Reconcile FIRST. A unique-index collision during the reparent fails the
    // whole merge, and a failed merge leaves someone signed in to an account
    // that does not contain their life.
    if (entry.reconcile) {
      const reconciled = await entry.reconcile(fromUserId, toUserId);
      if (reconciled > 0) {
        logger.info(
          { collection: entry.label, reconciled },
          "resolved conflicts before reparenting",
        );
      }
    }

    const result = await entry.model().updateMany(
      { [entry.userField]: fromUserId },
      { $set: { [entry.userField]: toUserId } },
    );
    moved[entry.label] = result.modifiedCount;
  }

  return moved;
}

/** Keeps the better of two entitlements. Never downgrades the survivor. */
function mergeEntitlement(survivor: UserDocument, absorbed: UserDocument): void {
  const paid = ["trialing", "active", "active_canceled"];
  const survivorPaid = paid.includes(survivor.entitlement.status);
  const absorbedPaid = paid.includes(absorbed.entitlement.status);

  // If the device being absorbed carries the paid entitlement — someone
  // purchased on the new phone before signing in — taking the survivor's free
  // status would delete a purchase.
  if (absorbedPaid && !survivorPaid) {
    survivor.entitlement.status = absorbed.entitlement.status;
    survivor.entitlement.expiresAt = absorbed.entitlement.expiresAt;
    survivor.entitlement.willRenew = absorbed.entitlement.willRenew;
    survivor.entitlement.lastVerifiedAt = absorbed.entitlement.lastVerifiedAt;
    if (absorbed.entitlement.revenueCatId) {
      survivor.entitlement.revenueCatId = absorbed.entitlement.revenueCatId;
    }
  }

  // Union the app-user ids either way: a webhook may still arrive under the
  // absorbed device's id, and it has to find the survivor.
  survivor.entitlement.revenueCatAppUserIds = [
    ...new Set([
      ...survivor.entitlement.revenueCatAppUserIds,
      ...absorbed.entitlement.revenueCatAppUserIds,
    ]),
  ];
}

export async function linkAccount(
  currentUserId: string,
  input: { provider: LinkProvider; accountId: string; email?: string },
): Promise<LinkResult> {
  const current = await resolveSurvivingUser(currentUserId);

  if (!current) {
    throw new NotFoundError("The authenticated user no longer exists.");
  }

  const existing = await UserModel.findOne({
    accountProvider: input.provider,
    accountId: input.accountId,
  });

  // Already this user's account. Idempotent: signing in twice is normal.
  if (existing && String(existing._id) === String(current._id)) {
    return { user: current, outcome: "already-linked" };
  }

  if (!existing) {
    if (current.accountId && current.accountId !== input.accountId) {
      // This device is already someone else's account. Silently re-pointing it
      // would move one person's history onto another person's identity.
      throw new ConflictError(
        "This device is already linked to a different account. Sign out first.",
      );
    }

    current.accountId = input.accountId;
    current.accountProvider = input.provider;
    if (input.email) current.email = input.email.toLowerCase();
    current.lastActiveAt = new Date();
    await current.save();

    logger.info(
      { userId: String(current._id), provider: input.provider },
      "account attached to existing device user",
    );

    return { user: current, outcome: "attached" };
  }

  // ---- Merge ---------------------------------------------------------------
  //
  // The account holder survives. Everything the device user owns moves to it.
  const moved = await moveOwnedDocuments(
    current._id as Types.ObjectId,
    existing._id as Types.ObjectId,
  );

  // The counter is history, not inventory: someone who used two free
  // conversations on an old phone and one on a new phone has used three.
  existing.abigailConversationsStarted += current.abigailConversationsStarted;

  mergeEntitlement(existing, current);

  if (input.email && !existing.email) existing.email = input.email.toLowerCase();
  existing.lastActiveAt = new Date();
  await existing.save();

  // Marked, not deleted. An in-flight token naming this id must still resolve.
  current.mergedIntoUserId = existing._id as Types.ObjectId;
  // Release the unique keys so this device can register cleanly again later.
  current.accountId = null;
  current.accountProvider = null;
  current.email = null;
  await current.save();

  logger.info(
    {
      absorbedUserId: String(current._id),
      survivingUserId: String(existing._id),
      moved,
      registeredCollections: OWNED_COLLECTIONS.length,
    },
    "device user merged into existing account",
  );

  return { user: existing, outcome: "merged", moved };
}

/** Guards against a collection being added to the schema but not the registry. */
export function assertOwnedCollectionsRegistered(expected: string[]): void {
  const registered = new Set(ownedCollectionLabels());
  const missing = expected.filter((label) => !registered.has(label));

  if (missing.length > 0) {
    throw new Error(
      `User-owned collections are not registered for account merging: ${missing.join(", ")}. ` +
        "Add them to OWNED_COLLECTIONS in services/users/account-link.service.ts — " +
        "an unregistered collection is silently left behind when someone changes phone.",
    );
  }
}

export { mongoose as _mongooseForTests };
