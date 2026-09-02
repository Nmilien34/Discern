// ARCHITECTURE.md §6, `conversations`. USER-OWNED — registered in OWNED_COLLECTIONS.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface ConversationDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  mode: "text" | "voice";
  startedAt: Date;
  endedAt: Date | null;
  /** Stages Abigail noticed evidence for, without necessarily naming one. */
  stageSignals: string[];
  summary: string | null;
  /** Assumptions the premise pass surfaced, kept for the nightly job. */
  premisesNoted: string[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: ["text", "voice"], required: true, default: "text" },
    startedAt: { type: Date, required: true, default: () => new Date() },
    endedAt: { type: Date, default: null },
    stageSignals: { type: [String], required: true, default: [] },
    summary: { type: String, default: null },
    premisesNoted: { type: [String], required: true, default: [] },
  },
  { timestamps: true, versionKey: false },
);

conversationSchema.index({ userId: 1, startedAt: -1 });
// No userId-scoped UNIQUE index, so no reconcile is needed on merge.

applyApiTransforms(conversationSchema);

export const ConversationModel = mongoose.model<ConversationDocument>(
  "Conversation",
  conversationSchema,
);
