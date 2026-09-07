// A READ — one sitting inside a virtue's path.
//
// THIS EXISTS NOW BECAUSE AVAILABILITY HAS TO BE DERIVED FROM IT.
//
// The launch plan is two virtues written and five not. Onboarding asks which of
// the seven vices has been loudest, and the reflection screen then names the
// person's virtue and the TITLE of their specific first read, which the paywall
// repeats. With five virtues unwritten, five out of seven people would be
// promised a read that does not exist, immediately before being asked to pay.
//
// The fix is that availability is DERIVED, never declared: a virtue is
// available when it actually has published reads. Not a constant, not an env
// var, not a list in the client. That means content lands incrementally and the
// app opens up on its own — write the third virtue, publish it, and onboarding
// starts offering it with no deploy — and staging and production behave
// correctly with different content and no branching.
//
// Which requires a collection to derive from. This is that collection, kept to
// what availability needs plus the fields the design's read screen already
// specifies, so the next pass fills rows rather than reshaping the model.
//
// `publishedAt` IS THE SWITCH. Null means written but not live. A row with a
// future date is not yet live either, so content can be staged.

import { STAGE_SLUGS, READ_TYPES } from "@discern/shared";
import type { StageSlug, ReadType } from "@discern/shared";
import { Schema, model } from "mongoose";
import type { Document, Model, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface CultivationReadPassage {
  /**
   * AS CITED, and as printed under the quote. "Proverbs 21:2".
   *
   * The client fetches the text by this reference rather than the read storing
   * it, which means a KJV reader gets KJV. Storing the quoted words would put
   * one translation inside an app that lets you choose the other.
   */
  reference: string;
  /**
   * EVERY STORED PERICOPE THE CITATION TOUCHES, in verse order.
   *
   * The corpus is segmented into pericopes, not verses: "Proverbs 21:2" renders
   * fine — `getPassageByReference` assembles any span out of `verses` — but it
   * comes back with `id: null`, which means it CANNOT BE CARRIED and has NO
   * AUDIO, because both key on a stored passage. "Proverbs 21:1-10" is the
   * stored unit that contains it.
   *
   * AN ARRAY SINCE 2026-09-06, and it had to become one. A read cites the unit
   * that makes an argument; the segmenter cut on narrative seams; the two
   * disagree, permanently. Four of humility's eleven citations straddle a
   * boundary, and in every case the pericope that fell outside was the half the
   * read turns on — John 13:3-5 lost the washing, Matthew 8:8-10 lost "he
   * marveled", Job 38:4-7 lost the morning stars, Job 42:5-6 lost "I abhor
   * myself" and the vindication one verse later that read 9 sends the reader to
   * find. A single reference could not express any of them.
   *
   * The CITED reference is kept separately and is never substituted, because
   * substituting would misattribute the quote: the read prints 21:2 and means
   * 21:2. This array is what the reader can carry and what can be given audio.
   *
   * Empty is possible in principle and refused at seed time — a citation in no
   * stored passage renders and is then a dead end.
   */
  storedReferences: string[];
  /** Null until the audio pass has run for this passage. */
  runtimeSeconds: number | null;
}

export interface CultivationReadDocument extends Document<Types.ObjectId> {
  stageSlug: StageSlug;
  /** 1-based position within the stage. The design shows "read 5 of 9". */
  order: number;
  type: ReadType;
  title: string;
  runtimeSeconds: number;
  /**
   * The painted header. Round 08's read screen opens with one.
   *
   * Art direction, not a file: "a room at dusk, one lamp, a table set for a meal
   * nobody has sat down to yet". The image key lands beside it when the asset
   * is made; until then this is what the brief says and it is stored with the
   * read rather than in a spreadsheet somewhere.
   */
  header: string | null;
  /**
   * Authored paragraphs. Stored split so the client never guesses at newlines.
   *
   * A paragraph whose entire content is a reference listed in `passages` is the
   * SET-APART PASSAGE BLOCK at that point in the flow — round 08's "one or two
   * passages set apart". A convention rather than a markup syntax, and the seed
   * script refuses to write a read where such a marker does not resolve.
   */
  body: string[];
  passages: CultivationReadPassage[];
  /**
   * The one thing to go and do, which becomes `action_taken` at weight 25.
   * Nullable: not every read has an ask, and inventing one is worse than
   * showing a read without one.
   */
  action: string | null;
  /** NULL = not live. A future date = not live yet. This is the switch. */
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const passageSchema = new Schema<CultivationReadPassage>(
  {
    reference: { type: String, required: true, trim: true },
    storedReferences: { type: [String], required: true, default: [] },
    runtimeSeconds: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

const cultivationReadSchema = new Schema<CultivationReadDocument>(
  {
    stageSlug: { type: String, enum: STAGE_SLUGS, required: true },
    order: { type: Number, required: true, min: 1 },
    type: { type: String, enum: READ_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    runtimeSeconds: { type: Number, required: true, min: 0 },
    header: { type: String, default: null, trim: true },
    body: { type: [String], required: true, default: [] },
    passages: { type: [passageSchema], required: true, default: [] },
    action: { type: String, default: null, trim: true },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Two reads cannot occupy the same position in a virtue.
cultivationReadSchema.index({ stageSlug: 1, order: 1 }, { unique: true });
// The availability query, and the sequence query, are both this index.
cultivationReadSchema.index({ stageSlug: 1, publishedAt: 1, order: 1 });

// NOT user-owned: the same reads for everybody, so deliberately absent from
// OWNED_COLLECTIONS — the same reasoning as stages.
applyApiTransforms(cultivationReadSchema);

export const CultivationReadModel: Model<CultivationReadDocument> =
  model<CultivationReadDocument>("CultivationRead", cultivationReadSchema);
