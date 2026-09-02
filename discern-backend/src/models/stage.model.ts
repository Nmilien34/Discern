// ARCHITECTURE.md §6, `stages`. Static config, seven documents, seeded.
//
// NOT user-owned — it is the same seven stages for everybody, so it is
// deliberately absent from OWNED_COLLECTIONS in account-link.service.

import type { StageSlug } from "@discern/shared";
import { STAGE_SLUGS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface StageDocument extends Document<Types.ObjectId> {
  slug: StageSlug;
  order: number;
  from: string;
  to: string;
  description: string;
  /** References that EXIST as stored passages. Asserted by the seed script. */
  anchorPassages: string[];
  openingQuestions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema<StageDocument>(
  {
    slug: { type: String, enum: STAGE_SLUGS, required: true },
    order: { type: Number, required: true, min: 1, max: 7 },
    from: { type: String, required: true, trim: true },
    to: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    anchorPassages: { type: [String], required: true, default: [] },
    openingQuestions: { type: [String], required: true, default: [] },
  },
  { timestamps: true, versionKey: false },
);

stageSchema.index({ slug: 1 }, { unique: true });
stageSchema.index({ order: 1 }, { unique: true });

// No soft-delete middleware on any config or corpus collection.
applyApiTransforms(stageSchema);

export const StageModel = mongoose.model<StageDocument>("Stage", stageSchema);
