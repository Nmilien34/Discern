// THE SPEND LEDGER FOR VOICE.
//
// ElevenLabs is the only cost in this app that scales with a single user's
// enthusiasm. Everything else — models, Atlas, Render — is bounded by what a
// conversation costs and how many people have one. Voice is bounded by nothing
// unless something bounds it, and a retry loop against a per-character API is
// how a month of credits disappears overnight.
//
// So: one row per scope per day, incremented ATOMICALLY before the spend
// happens. `$inc` returns the post-increment value, which is what makes the
// check race-free — two concurrent turns cannot both see "under the limit" and
// both proceed, because each one sees its own total after adding its share.
//
// Rows are cheap and self-expiring. They are a meter, not a history.

import { Schema, model } from "mongoose";
import type { Document, Model } from "mongoose";

export interface SpeechUsageDocument extends Document {
  /** "user:<id>" or the literal "global". */
  scope: string;
  /** UTC "YYYY-MM-DD". A day boundary somebody can reason about. */
  day: string;
  /** TTS characters submitted. The unit ElevenLabs bills. */
  charactersSynthesized: number;
  /** STT seconds submitted. Billed differently, so counted separately. */
  secondsTranscribed: number;
  requests: number;
  createdAt: Date;
  updatedAt: Date;
}

const speechUsageSchema = new Schema<SpeechUsageDocument>(
  {
    scope: { type: String, required: true },
    day: { type: String, required: true },
    charactersSynthesized: { type: Number, required: true, default: 0 },
    secondsTranscribed: { type: Number, required: true, default: 0 },
    requests: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

// One row per scope per day, and the uniqueness is what makes upsert+$inc safe.
speechUsageSchema.index({ scope: 1, day: 1 }, { unique: true });

// A meter does not need history. 60 days is long enough to answer "what did
// last month cost" and short enough that this never becomes a large collection.
speechUsageSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const SpeechUsageModel: Model<SpeechUsageDocument> =
  model<SpeechUsageDocument>("SpeechUsage", speechUsageSchema);
