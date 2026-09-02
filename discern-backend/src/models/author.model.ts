// ARCHITECTURE.md §6, `authors`.
//
// Author-first navigation is a CORE FEATURE, not a filter (Phase 2 brief), so
// this collection stores a person rather than a foreign key. Two fields carry
// that weight:
//
//   circumstances — what was happening to them when they wrote. This is what
//     makes Philippians read differently once you know it came from a prison,
//     and it is the body of Abigail's get_author_context tool in Phase 6.
//
//   attribution + attributionNote — Hebrews, Job, Judges, Kings, Chronicles and
//     Esther have no settled author. Presenting contested authorship as fact
//     loses trust permanently with anyone who knows; admitting uncertainty is
//     what earns it. The note is written for a reader, not a scholar.

import type { Attribution } from "@discern/shared";
import { ATTRIBUTIONS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface AuthorDocument extends Document<Types.ObjectId> {
  slug: string;
  name: string;
  era: string;
  bookSlugs: string[];
  bio: string;
  circumstances: string;
  attribution: Attribution;
  attributionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const authorSchema = new Schema<AuthorDocument>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    era: { type: String, required: true, trim: true },
    bookSlugs: { type: [String], required: true, default: [] },
    bio: { type: String, required: true, trim: true },
    circumstances: { type: String, required: true, trim: true },
    attribution: {
      type: String,
      enum: ATTRIBUTIONS,
      required: true,
      // NOT defaulted to "traditional". A default here would make the
      // comfortable answer the automatic one, which is precisely the failure
      // this field exists to prevent — an unlabelled author silently becomes a
      // confident claim. Seeds must state it.
      default: undefined,
    },
    // Deliberately NOT `required: true` with a "" default: Mongoose's `required`
    // tests truthiness rather than presence, so an empty-string default makes the
    // field unsatisfiable and every insert throws (CONVENTIONS.md §6).
    attributionNote: { type: String, trim: true },
  },
  { timestamps: true, versionKey: false },
);

authorSchema.index({ slug: 1 }, { unique: true });
authorSchema.index({ bookSlugs: 1 });
// Lets the reader surface "these books have no settled author" as a view rather
// than a caveat buried in a detail screen.
authorSchema.index({ attribution: 1 });

/**
 * An author whose attribution is contested must carry a note explaining it.
 *
 * Enforced in the SCHEMA rather than left to the seed script, because the rule
 * is about what may exist in the database at all, not about how one script
 * happens to write it. A disputed author with no note is a claim with the
 * evidence quietly removed.
 */
authorSchema.pre("validate", function requireNoteWhenContested(next) {
  if (this.attribution !== "traditional" && !this.attributionNote?.trim()) {
    next(
      new Error(
        `Author "${this.slug}" has attribution "${this.attribution}" but no ` +
          "attributionNote. Contested authorship must be explained to the " +
          "reader, not left as a bare label.",
      ),
    );
    return;
  }

  next();
});

// No soft-delete middleware. See translation.model.ts.
applyApiTransforms(authorSchema);

export const AuthorModel = mongoose.model<AuthorDocument>(
  "Author",
  authorSchema,
);
