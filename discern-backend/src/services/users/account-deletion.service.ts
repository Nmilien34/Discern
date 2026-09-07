// Account deletion.
//
// ONE REGISTRY, TWO CONSUMERS. This walks `ownedCollections()` — the same array
// account merging walks. It does not keep its own list. Two lists drift the
// first time somebody adds a collection and remembers only one of them, and the
// failure mode is silent orphaned data that surfaces as a privacy incident
// rather than as a bug report.
//
// Building this found two collections that were in neither: `processedWebhookEvents`
// and `speechUsage` both carry a user reference and neither was registered, so
// the MERGE had been leaving them behind since Phase 7. They are registered now.
//
// DELETE, NOT SOFT-DELETE. Apple's requirement is deletion. The single
// exception is `processedWebhookEvents`, which is genuinely anonymised — the
// user link is destroyed, the provider transaction core survives — because that
// row is the idempotency guard that stops a replayed webhook from granting
// entitlement twice, and it is the evidence needed to answer a refund. A
// flagged row would still be that person's data; a detached one is not.
//
// ORDER IS THE RESUMABILITY. The user document goes LAST. A failure partway
// through leaves the user present with some collections already empty, and a
// retry re-walks the registry: every step is an idempotent deleteMany, so
// already-deleted rows are a no-op rather than an error. If the user document
// went first, a mid-run failure would strand the remaining rows with no way to
// find them again.

import type { Types } from "mongoose";

import { logger } from "../../lib/logger";
import { UserModel } from "../../models";
import { ownedCollections } from "./account-link.service";

export interface DeletionResult {
  userId: string;
  /** label -> rows removed or anonymised. Proof, not decoration. */
  removed: Record<string, number>;
  /** Labels that were anonymised rather than deleted, and why. */
  retained: { collection: string; reason: string }[];
  deletedAt: string;
}

export async function deleteAccount(userId: Types.ObjectId): Promise<DeletionResult> {
  const startedAt = Date.now();
  const log = logger.child({ userId: String(userId), op: "account-deletion" });

  log.info("account deletion started");

  const removed: Record<string, number> = {};
  const retained: DeletionResult["retained"] = [];

  for (const entry of ownedCollections()) {
    const model = entry.model();
    const match = entry.userValue ? entry.userValue(userId) : userId;

    let count: number;

    if (typeof entry.erase === "function") {
      count = await entry.erase(userId, model, entry.userField);
      // `retainReason` is what distinguishes an ANONYMISATION from a custom
      // delete. seedEvents also uses a custom erase — because its schema
      // refuses deleteMany — but it is genuinely deleted and must not appear
      // here as retained data.
      if (entry.retainReason) {
        retained.push({ collection: entry.label, reason: entry.retainReason });
      }
    } else {
      const result = await model.deleteMany({ [entry.userField]: match });
      count = result.deletedCount ?? 0;
    }

    removed[entry.label] = count;
    // PER-COLLECTION PROGRESS, so a partial failure is diagnosable. Without
    // this, a run that dies on the fifth collection is indistinguishable from
    // one that never started.
    log.info({ collection: entry.label, count }, "collection cleared");
  }

  // LAST. See the note at the top.
  const userResult = await UserModel.deleteOne({ _id: userId });
  removed.user = userResult.deletedCount ?? 0;

  const result: DeletionResult = {
    userId: String(userId),
    removed,
    retained,
    deletedAt: new Date().toISOString(),
  };

  log.info(
    { removed, retained: retained.map((r) => r.collection), ms: Date.now() - startedAt },
    "account deletion complete",
  );

  return result;
}
