// ARCHITECTURE.md §6, `seedEvents` — AN APPEND-ONLY LEDGER.
//
// NOTHING IN THIS COLLECTION IS EVER UPDATED OR DELETED. Seed state is COMPUTED
// from these rows on every read (services/journey/seed.service.ts) using the
// curve in config/seed-growth.ts. There is no stored score anywhere, which is
// what lets the curve be retuned later without corrupting anyone's past.
//
// `weight` IS A MAGNITUDE, NOT A SCORE. Dwell seconds, conversation turns, or 1
// for the events that simply happened. Points are derived at read time. Storing
// points here would freeze today's opinion of what things are worth into every
// user's history — precisely the thing the append-only design exists to avoid.
//
// USER-OWNED. Registered in OWNED_COLLECTIONS: a ledger stranded on an old
// device is a seed that silently shrinks, which the design promises never
// happens.

import type { SeedEventType } from "@discern/shared";
import { SEED_EVENT_TYPES } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface SeedEventDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  type: SeedEventType;
  /** MAGNITUDE, not points. See the file header. */
  weight: number;
  at: Date;
  /** The carrying, conversation or stage this came from. */
  sourceId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const seedEventSchema = new Schema<SeedEventDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: SEED_EVENT_TYPES, required: true },
    weight: { type: Number, required: true, min: 0 },
    at: { type: Date, required: true, default: () => new Date() },
    sourceId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false },
);

seedEventSchema.index({ userId: 1, at: -1 });
seedEventSchema.index({ userId: 1, type: 1 });

/**
 * Append-only, enforced rather than documented.
 *
 * The ledger's whole value is that it is the record of what happened. A single
 * `updateOne` somewhere in a future phase — correcting a weight, "fixing" a
 * duplicate — would silently rewrite history that other numbers are derived
 * from, and nothing downstream would look wrong.
 *
 * ONE MUTATION IS PERMITTED: changing `userId`, and nothing else, in the same
 * update. That is an account merge reparenting the ledger to the surviving user
 * (services/users/account-link.service.ts), and it does not rewrite history — it
 * corrects WHOSE history it is.
 *
 * This exception is not a softening of the rule; it was found by the Phase 4
 * merge test the moment seedEvents was registered as user-owned. A blanket
 * refusal here means the ledger is silently left behind when someone changes
 * phone, which is the seed shrinking to zero — the one thing the no-decay
 * promise says can never happen.
 */
function isOwnershipReparent(update: unknown): boolean {
  if (!update || typeof update !== "object") return false;

  const doc = update as Record<string, unknown>;

  // Mongoose's OWN additions, because the schema sets `timestamps: true`:
  // `$set.updatedAt` and a top-level `$setOnInsert.createdAt`. Neither is part
  // of the caller's intent. A predicate written against the update as AUTHORED
  // rather than as SENT refuses every reparent, which is exactly what happened
  // the first two times this was written.
  const TIMESTAMP_FIELDS = new Set(["updatedAt", "createdAt"]);

  for (const key of Object.keys(doc)) {
    if (key === "$set") continue;

    if (key === "$setOnInsert") {
      const onInsert = Object.keys(
        (doc.$setOnInsert as Record<string, unknown>) ?? {},
      );
      if (onInsert.every((field) => TIMESTAMP_FIELDS.has(field))) continue;
      return false;
    }

    // Any other operator ($inc, $unset, $pull…) is a real mutation.
    return false;
  }

  const set = (doc.$set as Record<string, unknown>) ?? {};
  const meaningful = Object.keys(set).filter(
    (field) => !TIMESTAMP_FIELDS.has(field),
  );

  return meaningful.length === 1 && meaningful[0] === "userId";
}

function refuseMutation(
  this: { getUpdate?: () => unknown },
  next: (error?: Error) => void,
): void {
  if (typeof this.getUpdate === "function" && isOwnershipReparent(this.getUpdate())) {
    next();
    return;
  }

  next(
    new Error(
      "seedEvents is an APPEND-ONLY ledger (ARCHITECTURE.md §6). Rows are never " +
        "updated or deleted, except to reparent `userId` during an account " +
        "merge. To change what an event is worth, change the curve in " +
        "config/seed-growth.ts — the score is derived, not stored.",
    ),
  );
}

seedEventSchema.pre("updateOne", refuseMutation);
seedEventSchema.pre("updateMany", refuseMutation);
seedEventSchema.pre("findOneAndUpdate", refuseMutation);
seedEventSchema.pre("deleteOne", refuseMutation);
seedEventSchema.pre("deleteMany", refuseMutation);

// No soft-delete middleware, per CONVENTIONS.md §6: a pre(/^find/) hook that
// silently filtered rows would corrupt the derived seed for anyone it touched.
applyApiTransforms(seedEventSchema);

export const SeedEventModel = mongoose.model<SeedEventDocument>(
  "SeedEvent",
  seedEventSchema,
);
