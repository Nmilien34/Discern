// ARCHITECTURE.md §6 and §8, `safetyEvents`.
//
// Every time the gate fires, it is recorded. "All safety events logged for
// review" is not telemetry — it is the only way to find out whether the
// classifier is wrong in a direction that matters, and a false negative here is
// not a bad answer, it is a person in crisis handed a Bible verse.
//
// USER-OWNED, registered in OWNED_COLLECTIONS.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export const SAFETY_CLASSIFICATIONS = [
  "none",
  "crisis",
  "self_harm",
  "abuse_disclosure",
] as const;

export type SafetyClassification = (typeof SAFETY_CLASSIFICATIONS)[number];

export interface SafetyEventDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId | null;
  classification: SafetyClassification;
  at: Date;
  actionTaken: string;
  /**
   * A SHORT excerpt, not the whole message.
   *
   * Enough to review whether the classifier was right; not a transcript of the
   * worst moment of someone's life sitting in a log for the next five years.
   */
  messageExcerpt: string;
  modelUsed: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const safetyEventSchema = new Schema<SafetyEventDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
    classification: { type: String, enum: SAFETY_CLASSIFICATIONS, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    actionTaken: { type: String, required: true },
    messageExcerpt: { type: String, required: true },
    modelUsed: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

safetyEventSchema.index({ userId: 1, at: -1 });
safetyEventSchema.index({ classification: 1, at: -1 });

applyApiTransforms(safetyEventSchema);

export const SafetyEventModel = mongoose.model<SafetyEventDocument>(
  "SafetyEvent",
  safetyEventSchema,
);
