// ARCHITECTURE.md §6, `userStage`.
//
// USER-OWNED. Registered in OWNED_COLLECTIONS — a stage history stranded on an
// old device means Abigail forgets what she already worked out about someone.

import type { StageSlug } from "@discern/shared";
import { STAGE_ENTERED_BY, STAGE_SLUGS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface UserStageDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  stageSlug: StageSlug;
  enteredAt: Date;
  enteredBy: "abigail" | "user";
  /**
   * Why this stage was named.
   *
   * Required when Abigail names it, and enforced below. A stage she asserted
   * with no reason is a diagnosis with the evidence removed — the person should
   * always be able to ask "why do you think that" and get an answer.
   */
  evidence: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userStageSchema = new Schema<UserStageDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    stageSlug: { type: String, enum: STAGE_SLUGS, required: true },
    enteredAt: { type: Date, required: true, default: () => new Date() },
    enteredBy: { type: String, enum: STAGE_ENTERED_BY, required: true },
    evidence: { type: String, default: null, trim: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

userStageSchema.index({ userId: 1, enteredAt: -1 });
// At most one open stage per user. A partial unique index expresses that
// without an application-level check that races.
userStageSchema.index(
  { userId: 1, closedAt: 1 },
  { unique: true, partialFilterExpression: { closedAt: null } },
);

userStageSchema.pre("validate", function requireEvidenceFromAbigail(next) {
  if (this.enteredBy === "abigail" && !this.evidence?.trim()) {
    next(
      new Error(
        "A stage entered by Abigail must carry evidence. Naming where someone " +
          "is without saying why is a diagnosis they cannot question.",
      ),
    );
    return;
  }
  next();
});

// No soft-delete middleware.
applyApiTransforms(userStageSchema);

export const UserStageModel = mongoose.model<UserStageDocument>(
  "UserStage",
  userStageSchema,
);
