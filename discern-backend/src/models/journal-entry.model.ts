// The journal, as a server-side collection.
//
// MOVED HERE FROM THE PHONE ON 2026-09-06. What that buys is backup,
// cross-device, the released-carrying arc from round 13 working off history,
// and account deletion that actually reaches the journal. What it costs is the
// sentence "On this phone only. Nothing is sent anywhere," which is now false
// everywhere it appeared. See shared/src/schemas/journal.ts for the full
// reversal note.
//
// ── THE PROMISE THAT DID NOT MOVE ────────────────────────────────────────────
//
// THE JOURNAL NEVER REACHES ABIGAIL. Not summarised, not retrieved, not
// referenced, not used as context, NOT EMBEDDED.
//
// THERE IS NO EMBEDDING FIELD ON THIS SCHEMA AND THERE MUST NEVER BE ONE. Every
// other body of text in this database — passages, enriched summaries — carries
// one, and an embedded journal entry is a single $vectorSearch away from being
// retrievable by the pipeline that answers "find me something about this". That
// is the exact failure this design exists to prevent, and
// `src/tests/journal-isolation.test.ts` asserts the absence rather than
// trusting it.
//
// THIS MODEL IS NOT RE-EXPORTED FROM models/index.ts. The barrel imports it for
// side effect only, so its indexes are synced at boot but the symbol cannot be
// reached through the registry — which makes `import { JournalEntryModel } from
// "../models"` a compile error in the prompt and retrieval code rather than a
// review comment.
//
// ── NOT ENCRYPTED AT THE FIELD LEVEL, AND WHY ────────────────────────────────
//
// Atlas encryption at rest covers the disk. Field-level encryption on `body`
// was considered and NOT done, because the single-key version of it fails in
// exactly the way client-side E2EE fails: a key that is lost or rotated wrong
// loses every journal with no recovery, which is worse than the disclosure it
// prevents. Moving the key from a device keychain to a Render environment
// variable changes who holds it, not how recoverable it is. The version worth
// building is Atlas CSFLE with AWS KMS as the key provider — durable, audited,
// rotatable custody — and that is not cheap. Until then: encryption at rest,
// no embedding, no path to Abigail, and copy that says what is actually true.
//
// USER-OWNED. Registered in OWNED_COLLECTIONS with merge "reparent" and erase
// "remove", so deletion and merge both handle it with no second code path.

import type { JournalOrigin } from "@discern/shared";
import { JOURNAL_ORIGINS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface JournalEntryDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  /**
   * IDEMPOTENCY KEY FOR THE OFFLINE WRITE BUFFER.
   *
   * Local storage stays the buffer so an entry survives being offline. The
   * client mints this once, at write time, and resends it on every retry — so a
   * sync that fails four times produces one entry rather than four. Unique per
   * user, which is what makes the retry safe rather than merely likely to work.
   */
  clientId: string;
  body: string;
  /** The carrying that was active when this was written. Round 13. */
  carryingId: Types.ObjectId | null;
  /**
   * Denormalised so the chip still reads "Matthew 5:23-24" after release.
   * Release is routine: the active cap is three, and a fourth forces one down.
   */
  passageReference: string | null;
  origin: JournalOrigin;
  /** The client's clock. Differs from createdAt by however long sync took. */
  writtenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const journalEntrySchema = new Schema<JournalEntryDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    carryingId: { type: Schema.Types.ObjectId, ref: "Carrying", default: null },
    passageReference: { type: String, default: null, trim: true },
    origin: {
      type: String,
      enum: JOURNAL_ORIGINS,
      required: true,
      default: "journal",
    },
    writtenAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

// The by-time axis: the journal tab, newest first.
journalEntrySchema.index({ userId: 1, writtenAt: -1 });
// The by-carrying axis, and the released-carrying surface — "everything you
// wrote while you had it", in order.
journalEntrySchema.index({ userId: 1, carryingId: 1, writtenAt: -1 });
// Scoped to the user, not global: two people's phones may mint the same id, and
// a collision across accounts must not make one of them lose an entry.
journalEntrySchema.index({ userId: 1, clientId: 1 }, { unique: true });

applyApiTransforms(journalEntrySchema);

export const JournalEntryModel = mongoose.model<JournalEntryDocument>(
  "JournalEntry",
  journalEntrySchema,
);
