// ARCHITECTURE.md §6, `translations`.
//
// Translations are PLUGGABLE by design (§5): Discern launches on WEB + KJV,
// both public domain, and a licensed translation must be addable later without a
// migration. That is why every text is keyed by translationId rather than a
// column per translation.

import type { LicenseType } from "@discern/shared";
import { LICENSE_TYPES } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

/**
 * Where this translation's text actually came from.
 *
 * Extension beyond ARCHITECTURE.md §6, added at the Phase 2 gate. Public domain
 * is a claim about a specific EDITION, not about a title: eBible.org publishes a
 * "2020 stable text edition" of the WEB and a KJV using "the standardized text
 * of 1769", and those are the things that were ingested. A year from now,
 * "which edition is in this database" must be answerable from the database
 * rather than from memory — and if a licence claim is ever questioned, the
 * answer needs a URL, a filename and a date, not a recollection.
 *
 * The checksum is what makes the archived licence file in
 * scripts/corpus-licences/ meaningful: it ties that licence text to the exact
 * bytes that were parsed.
 */
export interface TranslationSourceDocument {
  url: string;
  archive: string;
  sha256: string;
  downloadedAt: Date;
  /** Path, relative to the backend, of the licence file kept from the archive. */
  licenceFile: string;
}

export interface TranslationDocument extends Document<Types.ObjectId> {
  abbreviation: string;
  name: string;
  licenseType: LicenseType;
  copyrightNotice: string;
  isDefault: boolean;
  /** Absent until the translation has actually been ingested from somewhere. */
  source?: TranslationSourceDocument;
  createdAt: Date;
  updatedAt: Date;
}

const translationSourceSchema = new Schema<TranslationSourceDocument>(
  {
    url: { type: String, required: true, trim: true },
    archive: { type: String, required: true, trim: true },
    sha256: { type: String, required: true, trim: true, lowercase: true },
    downloadedAt: { type: Date, required: true },
    licenceFile: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const translationSchema = new Schema<TranslationDocument>(
  {
    abbreviation: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    licenseType: {
      type: String,
      enum: LICENSE_TYPES,
      required: true,
      default: "public-domain",
    },
    // Every translation carries its notice, including public-domain ones, so a
    // reader screen never has to decide what to display and a licensed
    // translation added later has nowhere to hide its required attribution.
    copyrightNotice: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, required: true, default: false },
    // No default: a translation that has never been ingested must be
    // distinguishable from one whose provenance was not recorded.
    source: { type: translationSourceSchema },
  },
  { timestamps: true, versionKey: false },
);

translationSchema.index({ abbreviation: 1 }, { unique: true });
// At most one default. A partial unique index expresses this without a
// application-level check that races.
translationSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

// No soft-delete middleware on any corpus collection: the corpus is
// read-mostly reference data, and a pre(/^find/) hook that silently filtered it
// would be a whole translation disappearing for reasons nobody could see.
applyApiTransforms(translationSchema);

export const TranslationModel = mongoose.model<TranslationDocument>(
  "Translation",
  translationSchema,
);
