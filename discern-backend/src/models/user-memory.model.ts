// ARCHITECTURE.md §6, `userMemory` — small, structured, read EVERY turn.
//
// This is what makes Abigail feel like someone who knows you rather than a fresh
// chat. It lives in Mongo because it is read and filtered on every turn, and it
// is deliberately small: four short lists, not a transcript.
//
// `passagesGiven` is the one that earns its place. Without it she hands somebody
// the same verse in week three that she handed them in week one, which is the
// single fastest way to prove she is not listening.
//
// USER-OWNED, and it carries a UNIQUE index on userId — so it is exactly the
// collision that 500'd the merge in Phase 5. Both phones will have one. It has a
// reconcile.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface MemoryFact {
  text: string;
  source: "stated";
  at: Date;
  conversationId: Types.ObjectId | null;
}

export interface MemoryPerson {
  name: string;
  relationship: string;
  context: string;
}

export interface MemoryPassageGiven {
  ref: string;
  at: Date;
  why: string;
}

export interface MemoryThread {
  text: string;
  at: Date;
}

export interface UserMemoryDocument extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  /** Things the person SAID. Never inferred — see the `source` literal. */
  facts: MemoryFact[];
  peopleMentioned: MemoryPerson[];
  /** So she never repeats herself. */
  passagesGiven: MemoryPassageGiven[];
  /** What to ask about next time. Phase 8's nightly job also writes here. */
  openThreads: MemoryThread[];
  updatedAt: Date;
  createdAt: Date;
}

const factSchema = new Schema<MemoryFact>(
  {
    text: { type: String, required: true, trim: true },
    // Literal, not an enum with options. Memory holds what someone TOLD her; an
    // inferred "fact" recalled later as though they had said it is how an app
    // starts quietly telling people about themselves.
    source: { type: String, enum: ["stated"], required: true, default: "stated" },
    at: { type: Date, required: true, default: () => new Date() },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
  },
  { _id: false },
);

const personSchema = new Schema<MemoryPerson>(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    context: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const passageGivenSchema = new Schema<MemoryPassageGiven>(
  {
    ref: { type: String, required: true, trim: true },
    at: { type: Date, required: true, default: () => new Date() },
    why: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const threadSchema = new Schema<MemoryThread>(
  {
    text: { type: String, required: true, trim: true },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
);

const userMemorySchema = new Schema<UserMemoryDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    facts: { type: [factSchema], required: true, default: [] },
    peopleMentioned: { type: [personSchema], required: true, default: [] },
    passagesGiven: { type: [passageGivenSchema], required: true, default: [] },
    openThreads: { type: [threadSchema], required: true, default: [] },
  },
  { timestamps: true, versionKey: false },
);

// ONE MEMORY PER USER. This is the unique index that makes a reconcile mandatory
// on account merge — both devices will have created one.
userMemorySchema.index({ userId: 1 }, { unique: true });

applyApiTransforms(userMemorySchema);

export const UserMemoryModel = mongoose.model<UserMemoryDocument>(
  "UserMemory",
  userMemorySchema,
);
