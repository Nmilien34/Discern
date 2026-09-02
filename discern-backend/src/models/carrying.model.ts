// ARCHITECTURE.md §6, `carryings` — what the user is currently sitting with.
//
// The collection none of the competitor apps has, and the reason the app is not
// a reading queue. Everything tracked here is about RETURNING to something
// rather than acquiring the next thing: revisitCount, lastVisitedAt,
// totalDwellSeconds, and notes that accumulate rather than replace.
//
// RELEASED CARRYINGS ARE KEPT, NEVER DELETED. Someone should be able to look at
// what they carried a year ago — that history is the point, and a hard delete
// would make the app forget the thing it exists to remember.
//
// USER-OWNED. Registered in OWNED_COLLECTIONS. Losing these on a new phone is
// the one unforgivable bug in this app.

import type { CarryingKind, CarryingSource } from "@discern/shared";
import { CARRYING_KINDS, CARRYING_SOURCES } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface CarryingNote {
  text: string;
  at: Date;
}

export interface CarryingDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  kind: CarryingKind;
  refId: Types.ObjectId;
  addedAt: Date;
  source: CarryingSource;
  /** Abigail's reason for handing it over. Null when self-added. */
  why: string | null;
  revisitCount: number;
  lastVisitedAt: Date | null;
  totalDwellSeconds: number;
  notes: CarryingNote[];
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<CarryingNote>(
  {
    text: { type: String, required: true, trim: true },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
);

const carryingSchema = new Schema<CarryingDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: CARRYING_KINDS, required: true, default: "passage" },
    refId: { type: Schema.Types.ObjectId, required: true },
    addedAt: { type: Date, required: true, default: () => new Date() },
    source: { type: String, enum: CARRYING_SOURCES, required: true, default: "self" },
    why: { type: String, default: null, trim: true },
    revisitCount: { type: Number, required: true, default: 0, min: 0 },
    lastVisitedAt: { type: Date, default: null },
    totalDwellSeconds: { type: Number, required: true, default: 0, min: 0 },
    notes: { type: [noteSchema], required: true, default: [] },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

carryingSchema.index({ userId: 1, releasedAt: 1, addedAt: -1 });
// The same thing may be carried, released, and carried again later — that is a
// real and meaningful pattern — so uniqueness is only among ACTIVE carryings.
carryingSchema.index(
  { userId: 1, kind: 1, refId: 1, releasedAt: 1 },
  { unique: true, partialFilterExpression: { releasedAt: null } },
);

// No soft-delete middleware. `releasedAt` is product state, not deletion: a
// released carrying must stay visible in history.
applyApiTransforms(carryingSchema);

export const CarryingModel = mongoose.model<CarryingDocument>(
  "Carrying",
  carryingSchema,
);
