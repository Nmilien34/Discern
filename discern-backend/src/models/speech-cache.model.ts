// SYNTHESIZED AUDIO, KEYED BY CONTENT.
//
// The same words are read aloud over and over. Scripture especially: every
// person who is handed Psalm 46 hears the identical passage, and paying to
// synthesize it once per listener is paying for the same file thousands of
// times.
//
// The key is a hash of everything that could change the audio — the text, the
// voice, and every voice setting. Change the `style` dial and the hash changes,
// so a re-tuned voice does not silently serve the old recording; the old rows
// simply stop being hit and expire.
//
// Mongo holds the KEY, never the blob (ARCHITECTURE.md §4, storage split).

import { Schema, model } from "mongoose";
import type { Document, Model } from "mongoose";

export interface SpeechCacheDocument extends Document {
  /** sha256 of text + voice + settings. Unique. */
  hash: string;
  /** S3 object key. The audio itself never enters Mongo. */
  s3Key: string;
  characters: number;
  voiceId: string;
  /** Set for scripture so pregenerated passages are identifiable and kept. */
  passageReference: string | null;
  hits: number;
  lastHitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const speechCacheSchema = new Schema<SpeechCacheDocument>(
  {
    hash: { type: String, required: true, unique: true },
    s3Key: { type: String, required: true },
    characters: { type: Number, required: true },
    voiceId: { type: String, required: true },
    passageReference: { type: String, default: null },
    hits: { type: Number, required: true, default: 0 },
    lastHitAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Answers "what did pregeneration actually cover" without scanning.
speechCacheSchema.index({ passageReference: 1 });

export const SpeechCacheModel: Model<SpeechCacheDocument> =
  model<SpeechCacheDocument>("SpeechCache", speechCacheSchema);
