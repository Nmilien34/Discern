// ARCHITECTURE.md §6, `verses`.
//
// Verses back the READER — chapter-by-chapter navigation — and are the raw
// material segmentation groups into passages. They are deliberately NOT the
// retrievable unit and are never embedded: verse-level embeddings retrieve
// badly, and the product hands someone a passage to sit with, not a fragment.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface VerseDocument extends Document<Types.ObjectId> {
  translationId: Types.ObjectId;
  bookSlug: string;
  chapter: number;
  verse: number;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const verseSchema = new Schema<VerseDocument>(
  {
    translationId: {
      type: Schema.Types.ObjectId,
      ref: "Translation",
      required: true,
    },
    bookSlug: { type: String, required: true, trim: true, lowercase: true },
    chapter: { type: Number, required: true, min: 1 },
    verse: { type: Number, required: true, min: 1 },
    text: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

// The compound index named in ARCHITECTURE.md §6. Unique, which is also what
// makes ingestion idempotent: re-running it upserts on this key rather than
// duplicating a book.
verseSchema.index(
  { translationId: 1, bookSlug: 1, chapter: 1, verse: 1 },
  { unique: true },
);

// No soft-delete middleware. See translation.model.ts.
applyApiTransforms(verseSchema);

export const VerseModel = mongoose.model<VerseDocument>("Verse", verseSchema);
