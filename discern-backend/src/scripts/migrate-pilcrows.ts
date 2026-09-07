// Converts the KJV's inline paragraph marks to a flag.
//
//   npx tsx src/scripts/migrate-pilcrows.ts            dry run, writes nothing
//   npx tsx src/scripts/migrate-pilcrows.ts --apply
//
// 2,970 KJV verses begin with "¶ " — 9.5% of that translation, zero in WEB.
// It is a paragraph mark, not a word, and it was rendering into passage blocks,
// carryings, and the reader for anyone who chose KJV at onboarding.
//
// CONVERTED, NOT STRIPPED. The mark is real structure; where the paragraphs
// begin is something the reader screen wants. So `paragraphStart` takes the
// information and the character goes.
//
// THIS MUST RUN BEFORE ANY KJV SYNTHESIS. The audio cache key is a hash of the
// text, so synthesizing first means paying to have a narrator read 2,970
// pilcrows, and then paying AGAIN after this migration because every one of
// those hashes changes. The order is not a preference.
//
// Idempotent: splitParagraphMark leaves converted text alone, and the query
// only matches rows that still contain the character.

import mongoose from "mongoose";

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { assertWritable } from "../lib/production-guard";
import { splitParagraphMark } from "../lib/verse-text";
import { PassageModel, TranslationModel, VerseModel } from "../models";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  // Guarded only when it writes: a dry run against production is the point of
  // having one, and refusing it would push people to skip it.
  if (apply) assertWritable("migrate-pilcrows.ts");

  await connectToDatabase();
  assertCorpusWritable("migrate-pilcrows.ts");

  // ── PASSAGES, WHICH THE FIRST RUN MISSED ─────────────────────────────────
  //
  // `passages.texts` is a DENORMALISED JOIN of the verses, written at
  // segmentation time, and it is what `passage-audio.ts` reads for synthesis
  // and what retrieval returns. Cleaning `verses` alone left 1,982 passages
  // (2.3M characters of KJV) still carrying the character — so the ordering
  // constraint this script exists for, run before any KJV synthesis, was not
  // actually satisfied by the first run.
  //
  // STRIPPED HERE, NOT CONVERTED, and the difference is deliberate. On a verse
  // the mark is leading and means "this verse opens a paragraph", which is
  // structure worth keeping as `paragraphStart`. In a joined passage it appears
  // mid-string at verse boundaries, where there is nothing to attach a boolean
  // to — the structure already lives on the verses, and this copy is for
  // reading aloud and for retrieval. So the character goes and the double space
  // it leaves behind is collapsed.
  const passages = await PassageModel.find({}).select("reference texts").lean();
  const passageOps: { reference: string; texts: Record<string, string> }[] = [];

  for (const passage of passages) {
    const texts = passage.texts as unknown as Map<string, string> | Record<string, string>;
    const entries = texts instanceof Map ? [...texts.entries()] : Object.entries(texts ?? {});
    if (!entries.some(([, v]) => typeof v === "string" && v.includes("¶"))) continue;

    const cleaned: Record<string, string> = {};
    for (const [k, v] of entries) {
      cleaned[k] =
        typeof v === "string" ? v.replace(/¶\s*/g, "").replace(/[ \t]{2,}/g, " ").trim() : v;
    }
    passageOps.push({ reference: passage.reference, texts: cleaned });
  }

  const affected = await VerseModel.find({ text: /¶/ })
    .select("translationId bookSlug chapter verse text")
    .lean();

  if (affected.length === 0 && passageOps.length === 0) {
    logger.info("no verse or passage carries a paragraph mark — nothing to do");
    await disconnectFromDatabase();
    return;
  }

  // Per translation, so the report says which corpus this is actually touching
  // rather than a single number that could be hiding a surprise.
  const translations = await TranslationModel.find().select("abbreviation").lean();
  const nameById = new Map(
    translations.map((t) => [String(t._id), t.abbreviation as string]),
  );

  const byTranslation = new Map<string, number>();
  let leading = 0;
  let midVerse = 0;

  logger.info(
    {
      passages: passageOps.length,
      sample: passageOps.slice(0, 3).map((p) => p.reference),
    },
    "passages whose joined text still carries the character",
  );

  const operations = affected.map((verse) => {
    const key = nameById.get(String(verse.translationId)) ?? "unknown";
    byTranslation.set(key, (byTranslation.get(key) ?? 0) + 1);

    const split = splitParagraphMark(verse.text);
    if (split.paragraphStart) leading += 1;
    // A mark that is NOT leading is not a paragraph start and this migration
    // does not know what it is. It is counted and left alone rather than
    // guessed at.
    if (split.text.includes("¶")) midVerse += 1;

    return {
      updateOne: {
        filter: { _id: verse._id },
        update: { $set: { text: split.text, paragraphStart: split.paragraphStart } },
      },
    };
  });

  const sample = affected.slice(0, 3).map((v) => ({
    ref: `${v.bookSlug} ${v.chapter}:${v.verse}`,
    before: v.text.slice(0, 58),
    after: splitParagraphMark(v.text).text.slice(0, 58),
  }));

  logger.info(
    {
      verses: affected.length,
      byTranslation: Object.fromEntries(byTranslation),
      leadingMarks: leading,
      marksLeftInPlace: midVerse,
      sample,
      applied: apply,
    },
    apply ? "converting" : "DRY RUN — would convert",
  );

  if (midVerse > 0) {
    logger.warn(
      { count: midVerse },
      "some marks are NOT at the start of a verse. Those are not paragraph " +
        "starts, this migration does not know what they are, and it is leaving " +
        "them exactly where they were.",
    );
  }

  if (!apply) {
    logger.info("nothing was written. Re-run with --apply to convert.");
    await disconnectFromDatabase();
    return;
  }

  if (passageOps.length > 0) {
    const passageResult = await PassageModel.bulkWrite(
      passageOps.map((p) => ({
        updateOne: { filter: { reference: p.reference }, update: { $set: { texts: p.texts } } },
      })) as Parameters<typeof PassageModel.bulkWrite>[0],
      { ordered: false },
    );
    logger.info({ modified: passageResult.modifiedCount }, "passages cleaned");
  }

  const result = await VerseModel.bulkWrite(
    operations as Parameters<typeof VerseModel.bulkWrite>[0],
    { ordered: false },
  );

  const remaining = await VerseModel.countDocuments({ text: /¶/ });
  const flagged = await VerseModel.countDocuments({ paragraphStart: true });

  logger.info(
    { modified: result.modifiedCount, remaining, paragraphStartsNow: flagged },
    remaining === 0
      ? "done — no verse in the corpus carries the character any more"
      : "done, but some marks remain (see the warning above)",
  );

  await disconnectFromDatabase();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "migrate-pilcrows failed");
  void mongoose.disconnect().finally(() => process.exit(1));
});
