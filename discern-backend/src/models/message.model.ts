// ARCHITECTURE.md §6, `messages`.
//
// USER-OWNED, and it carries `userId` DIRECTLY as well as conversationId. That
// denormalisation exists for exactly one reason: the account merge reparents by
// a userId field, and a message reachable only through its conversation would be
// stranded on a phone change unless the merge learned to walk relationships.
// One indexed field is cheaper and far harder to get wrong.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface MessageCitation {
  ref: string;
  translationId: Types.ObjectId | null;
  passageId: Types.ObjectId | null;
}

export interface MessageToolCall {
  name: string;
  arguments: string;
  resultSummary: string;
}

export interface MessageDocument extends Document<Types.ObjectId> {
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "user" | "assistant" | "system";
  content: string;
  /** S3 key, voice mode only. Phase 7. */
  audioKey: string | null;
  citations: MessageCitation[];
  toolCalls: MessageToolCall[];
  modelUsed: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** True when the safety gate answered instead of the reasoning path. */
  safetyIntercepted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const citationSchema = new Schema<MessageCitation>(
  {
    ref: { type: String, required: true },
    translationId: { type: Schema.Types.ObjectId, ref: "Translation", default: null },
    passageId: { type: Schema.Types.ObjectId, ref: "Passage", default: null },
  },
  { _id: false },
);

const toolCallSchema = new Schema<MessageToolCall>(
  {
    name: { type: String, required: true },
    arguments: { type: String, required: true },
    resultSummary: { type: String, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema<MessageDocument>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true },
    audioKey: { type: String, default: null },
    citations: { type: [citationSchema], required: true, default: [] },
    toolCalls: { type: [toolCallSchema], required: true, default: [] },
    modelUsed: { type: String, default: null },
    tokensIn: { type: Number, required: true, default: 0 },
    tokensOut: { type: Number, required: true, default: 0 },
    latencyMs: { type: Number, required: true, default: 0 },
    safetyIntercepted: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, versionKey: false },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ userId: 1, createdAt: -1 });
// modelUsed is stored per message so spend is attributable per conversation
// (ARCHITECTURE.md §7). This index makes that query cheap.
messageSchema.index({ modelUsed: 1 });

applyApiTransforms(messageSchema);

export const MessageModel = mongoose.model<MessageDocument>("Message", messageSchema);
