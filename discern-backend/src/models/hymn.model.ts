// ARCHITECTURE.md §6, `hymns`.
//
// LICENSING IS A HARD CONSTRAINT (§5). Pre-1929 hymns are public domain — Wesley,
// Crosby, Watts, "Nearer, My God, to Thee". Modern worship lyrics are owned by
// publishers EVEN AS TEXT. `isPublicDomain` is required and validated rather
// than advisory, because the failure mode is shipping licensed lyrics.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface HymnDocument extends Document<Types.ObjectId> {
  title: string;
  author: string;
  /** Year of publication. Drives the public-domain check. */
  year: number;
  isPublicDomain: boolean;
  stanzas: string[];
  themes: string[];
  stageSlugs: string[];
  situations: string[];
  /** Title, author and stanzas flattened for keyword search. */
  searchText?: string;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hymnSchema = new Schema<HymnDocument>(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    year: { type: Number, required: true },
    isPublicDomain: { type: Boolean, required: true },
    stanzas: { type: [String], required: true, default: [] },
    themes: { type: [String], required: true, default: [] },
    stageSlugs: { type: [String], required: true, default: [] },
    situations: { type: [String], required: true, default: [] },
    searchText: { type: String },
    // See passage.model.ts: without `default: undefined` Mongoose writes `[]`
    // and "has not been embedded" becomes unaskable.
    embedding: { type: [Number], default: undefined },
    embeddingModel: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false },
);

hymnSchema.index({ title: 1, author: 1 }, { unique: true });
hymnSchema.index({ stageSlugs: 1 });
hymnSchema.index({ situations: 1 });
hymnSchema.index({ themes: 1 });
hymnSchema.index({ embeddingModel: 1 });
hymnSchema.index({ searchText: "text" }, { name: "hymn_text" });

/**
 * Refuses to store a hymn marked public domain that is not plainly so.
 *
 * ARCHITECTURE.md §5 draws the line at 1929. This does not try to be a lawyer —
 * it catches the one mistake that actually happens, which is a modern worship
 * lyric added to the corpus with the flag left true because every row above it
 * was true.
 */
hymnSchema.pre("validate", function checkPublicDomain(next) {
  if (this.isPublicDomain && this.year > 1929) {
    next(
      new Error(
        `Hymn "${this.title}" (${this.year}) is marked public domain, but ` +
          "ARCHITECTURE.md §5 ships PRE-1929 hymns only. Modern worship lyrics " +
          "are owned by publishers even as text.",
      ),
    );
    return;
  }

  next();
});

// No soft-delete middleware. The omit list is the same rule as passages: an
// embedding must never reach a client.
applyApiTransforms(hymnSchema, ["embedding", "embeddingModel", "searchText"]);

export const HymnModel = mongoose.model<HymnDocument>("Hymn", hymnSchema);
