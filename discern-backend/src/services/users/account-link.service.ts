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
// Imported from its own file rather than the barrel: the journal is
// deliberately not re-exported from models/index.ts. See that file.
import { JournalEntryModel } from "../../models/journal-entry.model";
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
/**
 * How a collection participates in a MERGE.
 *
 * `skip` is for rows that are keyed to a user but are not that user's history —
 * daily counters that roll over on their own. Moving them buys nothing and can
 * collide on a unique index.
 */
export type MergeStrategy =
  | "reparent"
  | "skip"
  /**
   * Merge the rows by ADDING them, rather than by moving them.
   *
   * For counters. A reparent collides on any unique key the survivor already
   * holds, and skipping silently discards what the absorbed user spent — which
   * is how linking mid-day handed somebody a fresh daily allowance.
   */
  | ((fromUserId: Types.ObjectId, toUserId: Types.ObjectId) => Promise<number>);

/**
 * How a collection participates in a DELETION.
 *
 * `remove` deletes the rows. A function ANONYMISES them instead, and is for the
 * one case where deleting is not available: records that must survive to answer
 * a refund or to stop a webhook replay double-granting. Anonymise means the
 * user link is destroyed, not that a flag is set — a flagged row is still that
 * person's data.
 */
export type EraseStrategy =
  | "remove"
  | ((userId: Types.ObjectId, model: Model<unknown>, field: string) => Promise<number>);

export interface OwnedCollection {
  label: string;
  model: () => Model<unknown>;
  userField: string;
  /**
   * What to match `userField` against, when the reference is not the raw id.
   * `speechUsage` keys on the string "user:<id>", so it needs this.
   */
  userValue?: (userId: Types.ObjectId) => unknown;
  /** Default "reparent". */
  merge?: MergeStrategy;
  /** Default "remove". */
  erase?: EraseStrategy;
  /**
   * Set ONLY when `erase` anonymises rather than deletes. Its presence is what
   * puts the collection in the deletion result's `retained` list, so a custom
   * erase that still deletes everything is not mislabelled as retained data.
   */
  retainReason?: string;
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
    // APPEND-ONLY LEDGER. Its schema refuses deleteMany outright, so erasing it
    // needs the narrow `accountDeletion` escape rather than a plain delete —
    // see the guard in models/seed-event.model.ts. Deleted, not retained: a
    // deleted person does not have a growth score.
    label: "seedEvents",
    model: () => SeedEventModel as never,
    userField: "userId",
    erase: eraseSeedEvents,
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
  // ── Registered 2026-09-06, found missing while building deletion ──────────
  //
  // Both of these carry a user reference and NEITHER was in this list, so the
  // merge has been leaving them behind since Phase 7. That is a pre-existing
  // bug in merge, not only a hole in deletion.
  {
    // BILLING EVIDENCE. Reparented on merge, because a person's purchase
    // history should follow their account. NOT deleted on erase: this row is
    // the idempotency guard that stops a replayed RevenueCat webhook from
    // granting entitlement twice, and it is the evidence needed to answer a
    // refund. `detachedAt` was added to this model for exactly this and nothing
    // has ever set it until now.
    label: "processedWebhookEvents",
    model: () => ProcessedWebhookEventModel as never,
    userField: "userId",
    erase: detachWebhookEvents,
    retainReason:
      "Anonymised, not deleted. The user link, RevenueCat customer id and app " +
      "user id are erased; the provider transaction record survives so a " +
      "replayed webhook cannot double-grant entitlement and a refund can still " +
      "be answered.",
  },
  // ── Registered 2026-09-06 with the journal itself ────────────────────────
  {
    // THE JOURNAL. Registered in the same commit that created it, which is the
    // whole reason this list works — a collection added later and registered
    // never is invisible until someone changes phone.
    //
    // DEFAULTS ON BOTH SIDES, deliberately: merge "reparent" and erase
    // "remove". Reparent, because the journal is the single most painful thing
    // to strand behind an unreachable id. Remove, because it moved onto our
    // servers precisely so that deleting the account could reach it — leaving
    // it behind would recreate the contradiction the move was made to resolve.
    //
    // No `reconcile`: the unique index is {userId, clientId}, and clientIds are
    // minted per device, so a merge cannot collide the way userStages did.
    label: "journalEntries",
    model: () => JournalEntryModel as never,
    userField: "userId",
  },
  {
    // DAILY SPEECH COUNTERS, keyed "user:<id>" rather than by ObjectId.
    //
    // SKIPPED on merge: these roll over at midnight and already expire after 60
    // days, so moving them buys nothing — and `{scope, day}` is UNIQUE, so a
    // reparent where both devices spoke today is a guaranteed E11000 that would
    // fail the entire merge. Removed on erase, because 60 days is not an answer
    // to "delete my account".
    label: "speechUsage",
    model: () => SpeechUsageModel as never,
    userField: "scope",
    userValue: (userId) => `user:${String(userId)}`,
    merge: mergeSpeechUsage,
  },
];

/**
 * Adds the absorbed user's speech spend to the survivor's, day by day.
 *
 * IT USED TO BE `merge: "skip"`, AND SKIPPING WAS A FREE DAILY ALLOWANCE.
 * Someone using the app anonymously, spending most of their 40,000 characters,
 * and then signing in got a survivor row with a different scope — so the
 * ceiling started again from zero, mid-day, repeatably. Worth roughly $12 each
 * time, bounded only by the 500,000 global ceiling at $150 a day.
 *
 * Reparenting is not available and that reasoning still holds: `{scope, day}`
 * is UNIQUE, so moving a row for a day the survivor also spent on is a
 * guaranteed E11000, and an E11000 here fails the entire merge — leaving
 * somebody signed in to an account that does not contain their life.
 *
 * So the rows are ADDED rather than moved: one upsert-with-$inc per day into
 * the survivor's scope, then the absorbed row is dropped. THE LEDGER IS NOT
 * RESCOPED — every row still belongs to exactly one user and the day key is
 * untouched — and the counters end up saying what the person actually spent.
 *
 * Days the survivor never spent on are created by the upsert, which is why this
 * cannot be an `updateMany`.
 */
async function mergeSpeechUsage(
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<number> {
  const fromScope = `user:${String(fromUserId)}`;
  const toScope = `user:${String(toUserId)}`;

  const rows = await SpeechUsageModel.find({ scope: fromScope }).lean();
  let merged = 0;

  for (const row of rows) {
    await SpeechUsageModel.updateOne(
      { scope: toScope, day: row.day },
      {
        $inc: {
          charactersSynthesized: row.charactersSynthesized ?? 0,
          secondsTranscribed: row.secondsTranscribed ?? 0,
          requests: row.requests ?? 0,
          proseCharacters: row.proseCharacters ?? 0,
          scriptureCharacters: row.scriptureCharacters ?? 0,
        },
      },
      { upsert: true },
    );
    merged += 1;
  }

  // Dropped only after the addition lands. A crash between the two leaves the
  // spend counted twice, which errs toward refusing a request rather than
  // toward granting free characters.
  if (rows.length > 0) await SpeechUsageModel.deleteMany({ scope: fromScope });

  return merged;
}

/** The append-only ledger's one sanctioned erase path. */
async function eraseSeedEvents(
  userId: Types.ObjectId,
  model: Model<unknown>,
): Promise<number> {
  const result = await model.deleteMany({ userId }, { accountDeletion: true });
  return result.deletedCount ?? 0;
}

/**
 * Anonymise rather than delete. The user link goes; the provider transaction
 * core stays, which is what the model's own comment asks for.
 */
async function detachWebhookEvents(
  userId: Types.ObjectId,
  model: Model<unknown>,
): Promise<number> {
  const result = await model.updateMany(
    { userId, detachedAt: null },
    {
      $set: {
        userId: null,
        appUserId: null,
        revenueCatCustomerId: null,
        detachedAt: new Date(),
      },
    },
  );
  return result.modifiedCount;
}

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

/**
 * The registry, for the second consumer.
 *
 * ONE REGISTRY, TWO CONSUMERS. Deletion reads this rather than keeping its own
 * list, because two lists drift the first time somebody adds a collection and
 * updates only one of them — and the failure is silent orphaned data that
 * nobody notices until it is a privacy incident.
 */
export function ownedCollections(): readonly OwnedCollection[] {
  return OWNED_COLLECTIONS;
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

/**
 * EXPORTED FOR TESTS ONLY, and named so that is unmistakable at the call site.
 *
 * The alternative is driving a full `linkAccount` to exercise one collection's
 * merge strategy, which needs a verified provider token and tests the wrong
 * thing. This is the unit that decides whether anybody's history survives.
 */
export const moveOwnedDocumentsForTest = (
  fromUserId: Types.ObjectId,
  toUserId: Types.ObjectId,
): Promise<Record<string, number>> => moveOwnedDocuments(fromUserId, toUserId);

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

    if (entry.merge === "skip") {
      moved[entry.label] = 0;
      continue;
    }

    if (typeof entry.merge === "function") {
      moved[entry.label] = await entry.merge(fromUserId, toUserId);
      continue;
    }

    const match = entry.userValue ? entry.userValue(fromUserId) : fromUserId;
    const next = entry.userValue ? entry.userValue(toUserId) : toUserId;

    const result = await entry
      .model()
      .updateMany({ [entry.userField]: match }, { $set: { [entry.userField]: next } });
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

/**
 * Link or merge an account.
 *
 * `input.accountId` MUST come from a verified provider token — see
 * services/users/identity-verification.ts. This function does not verify
 * anything itself; it is the caller's job, and the only caller is the route,
 * which verifies first. Never call this with a value taken from a request body.
 */
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
