// ARCHITECTURE.md §6, `books`.

import type { Testament } from "@discern/shared";
import { TESTAMENTS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface BookDocument extends Document<Types.ObjectId> {
  slug: string;
  name: string;
  testament: Testament;
  canonicalOrder: number;
  /**
   * Nullable on purpose. Several books have no author document to point at —
   * not because the data is incomplete, but because nobody knows who wrote
   * them. Forcing a reference here would mean inventing one.
   */
  authorId: Types.ObjectId | null;
  chapterCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const bookSchema = new Schema<BookDocument>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    testament: { type: String, enum: TESTAMENTS, required: true },
    canonicalOrder: { type: Number, required: true, min: 1, max: 66 },
    authorId: { type: Schema.Types.ObjectId, ref: "Author", default: null },
    chapterCount: { type: Number, required: true, min: 1 },
  },
  { timestamps: true, versionKey: false },
);

bookSchema.index({ slug: 1 }, { unique: true });
bookSchema.index({ canonicalOrder: 1 }, { unique: true });
bookSchema.index({ authorId: 1 });
bookSchema.index({ testament: 1, canonicalOrder: 1 });

// No soft-delete middleware. See translation.model.ts.
applyApiTransforms(bookSchema);

export const BookModel = mongoose.model<BookDocument>("Book", bookSchema);
