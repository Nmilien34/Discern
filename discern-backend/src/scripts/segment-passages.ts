// Groups ingested verses into passages — the retrievable unit.
//
//   npm run segment -w @discern/backend
//   npm run segment -w @discern/backend -- --only ephesians,philippians
//
// Boundaries come from the DEFAULT translation's verses, then every other
// translation's text for the same span is written into the same passage. That
// ordering matters: a passage is one unit of thought that exists in several
// translations, not a different passage per translation. It is also what lets
// ARCHITECTURE.md §5 add a licensed translation later by filling in a map entry
// rather than re-segmenting the corpus.
//
// IDEMPOTENT. Passages upsert on `reference`, so re-running after a change to
// the curated pericope table updates the affected passages in place. Any
// embedding already written is left untouched unless the text actually changed —
// see the note on invalidation below.

import { bookBySlug } from "@discern/shared";

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { formatReference } from "../lib/reference";
import { BookModel, PassageModel, TranslationModel, VerseModel } from "../models";
import type { SegmentInputVerse } from "../services/corpus/segment";
import { findCuratedOverlaps, segmentBook } from "../services/corpus/segment";

function parseArgs(argv: string[]): { only?: string[] } {
  const index = argv.indexOf("--only");
  if (index === -1) return {};

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return {};

  return { only: value.split(",").map((slug) => slug.trim()) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Fail before writing anything. Two curated ranges claiming the same verse
  // makes coverage stop being a partition, and the symptom (a verse appearing in
  // two passages) shows up far from the edit that caused it.
  const overlaps = findCuratedOverlaps();
  if (overlaps.length > 0) {
    throw new Error(
      ["Curated pericopes overlap:", ...overlaps.map((o) => `  ${o}`)].join("\n"),
    );
  }

  await connectToDatabase();
  assertCorpusWritable("segment-passages");

  const translations = await TranslationModel.find().sort({ abbreviation: 1 });

  if (translations.length === 0) {
    throw new Error(
      "No translations in the database. Run the seed script first: " +
        "npm run seed -w @discern/backend",
    );
  }

  const defaultTranslation =
    translations.find((translation) => translation.isDefault) ?? translations[0];

  if (!defaultTranslation) {
    throw new Error("No default translation could be resolved.");
  }

  logger.info(
    {
      boundaryTranslation: defaultTranslation.abbreviation,
      translations: translations.length,
    },
    "segmentation starting",
  );

  const bookFilter = args.only ? { slug: { $in: args.only } } : {};
  const books = await BookModel.find(bookFilter).sort({ canonicalOrder: 1 });

  let passagesWritten = 0;
  let staleRemoved = 0;
  const bySource = { curated: 0, "whole-chapter": 0, discourse: 0 };

  for (const book of books) {
    const meta = bookBySlug(book.slug);
    if (!meta) continue;

    // Boundaries come from the default translation where it has been ingested.
    //
    // FALLING BACK MATTERS. A partial corpus is the normal state during setup —
    // one translation arrives before the other — and deriving boundaries only
    // from the default means segmentation silently writes NOTHING while
    // reporting success. That is a worse failure than using another
    // translation's boundaries, because it looks like it worked.
    let boundaryTranslation = defaultTranslation;

    let boundaryVerses = await VerseModel.find({
      translationId: defaultTranslation._id,
      bookSlug: book.slug,
    })
      .sort({ chapter: 1, verse: 1 })
      .lean();

    if (boundaryVerses.length === 0) {
      for (const candidate of translations) {
        if (String(candidate._id) === String(defaultTranslation._id)) continue;

        const candidateVerses = await VerseModel.find({
          translationId: candidate._id,
          bookSlug: book.slug,
        })
          .sort({ chapter: 1, verse: 1 })
          .lean();

        if (candidateVerses.length > 0) {
          boundaryTranslation = candidate;
          boundaryVerses = candidateVerses;
          logger.warn(
            {
              book: book.slug,
              missing: defaultTranslation.abbreviation,
              usingInstead: candidate.abbreviation,
            },
            "default translation not ingested for this book; taking boundaries " +
              "from another translation",
          );
          break;
        }
      }
    }

    if (boundaryVerses.length === 0) continue;
    void boundaryTranslation;

    const boundaries = segmentBook(
      boundaryVerses.map(
        (verse): SegmentInputVerse => ({
          chapter: verse.chapter,
          verse: verse.verse,
          text: verse.text,
        }),
      ),
      { bookSlug: book.slug, chapterCount: meta.chapterCount },
    );

    for (const boundary of boundaries) {
      const reference = formatReference({
        bookName: meta.name,
        startChapter: boundary.startChapter,
        startVerse: boundary.startVerse,
        endChapter: boundary.endChapter,
        endVerse: boundary.endVerse,
      });

      // Every translation's text for this exact span.
      const texts = new Map<string, string>();

      for (const translation of translations) {
        const spanVerses = await VerseModel.find({
          translationId: translation._id,
          bookSlug: book.slug,
          $or: [
            {
              chapter: boundary.startChapter,
              ...(boundary.startChapter === boundary.endChapter
                ? { verse: { $gte: boundary.startVerse, $lte: boundary.endVerse } }
                : { verse: { $gte: boundary.startVerse } }),
            },
            ...(boundary.endChapter > boundary.startChapter
              ? [
                  {
                    chapter: { $gt: boundary.startChapter, $lt: boundary.endChapter },
                  },
                  {
                    chapter: boundary.endChapter,
                    verse: { $lte: boundary.endVerse },
                  },
                ]
              : []),
          ],
        })
          .sort({ chapter: 1, verse: 1 })
          .lean();

        if (spanVerses.length === 0) continue;

        texts.set(
          String(translation._id),
          spanVerses.map((verse) => verse.text).join(" "),
        );
      }

      if (texts.size === 0) continue;

      await PassageModel.updateOne(
        { reference },
        {
          $set: {
            reference,
            bookSlug: book.slug,
            authorId: book.authorId,
            chapter: boundary.startChapter,
            startVerse: boundary.startVerse,
            endChapter: boundary.endChapter,
            endVerse: boundary.endVerse,
            texts,
            // Keyword-search field, from the default translation. Written here
            // so it can never drift from `texts`.
            searchText:
              texts.get(String(defaultTranslation._id)) ??
              [...texts.values()][0] ??
              "",
            ...(boundary.note ? { textualNote: boundary.note } : {}),
          },
          // themes / stageSlugs / situations are set on INSERT only, so a
          // re-segmentation never wipes curation added later. Phase 3 populates
          // them; nothing here should overwrite that work.
          $setOnInsert: { themes: [], stageSlugs: [], situations: [] },
        },
        { upsert: true },
      );

      passagesWritten += 1;
      bySource[boundary.source] += 1;
    }

    // Remove passages for this book that the current table no longer produces.
    //
    // Without this, editing the curated table LEAVES THE OLD PASSAGE BEHIND:
    // replacing "Isaiah 53:1-12" with "Isaiah 52:13-53:12" would leave both in
    // the collection, the same verses would live in two passages, and retrieval
    // would return the text twice under different references. Upserting alone
    // cannot express a deletion.
    const currentReferences = boundaries.map((boundary) =>
      formatReference({
        bookName: meta.name,
        startChapter: boundary.startChapter,
        startVerse: boundary.startVerse,
        endChapter: boundary.endChapter,
        endVerse: boundary.endVerse,
      }),
    );

    const stale = await PassageModel.find({
      bookSlug: book.slug,
      reference: { $nin: currentReferences },
    })
      .select("reference")
      .lean();

    if (stale.length > 0) {
      await PassageModel.deleteMany({
        bookSlug: book.slug,
        reference: { $nin: currentReferences },
      });
      logger.warn(
        {
          book: book.slug,
          removed: stale.length,
          references: stale.map((p) => p.reference).slice(0, 8).join(", "),
        },
        "removed passages the current pericope table no longer produces",
      );
      staleRemoved += stale.length;
    }

    logger.info(
      {
        book: book.slug,
        verses: boundaryVerses.length,
        passages: boundaries.length,
      },
      "book segmented",
    );
  }

  logger.info(
    {
      passages: passagesWritten,
      staleRemoved,
      curated: bySource.curated,
      wholeChapter: bySource["whole-chapter"],
      discourse: bySource.discourse,
    },
    "segmentation complete",
  );

  // Zero passages from a non-empty corpus is a failure wearing a success
  // message. Say so rather than exiting 0 and letting the next phase discover it.
  if (passagesWritten === 0) {
    const verseCount = await VerseModel.estimatedDocumentCount();

    logger.warn(
      { verses: verseCount, booksConsidered: books.length },
      verseCount === 0
        ? "no passages written: no verses have been ingested. Run ingest-bible first."
        : "no passages written despite verses existing — this is a bug, not an empty corpus",
    );
  }

  // Phase 3 will need to know that a re-segmented passage's text may have moved
  // under an embedding written against the old boundary. The backfill selects on
  // embeddingModel, so the honest signal is to say so here rather than to
  // silently leave a stale vector attached to different words.
  logger.info(
    "if any passage text changed, re-run the Phase 3 embedding backfill for it",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "segmentation failed",
    );
    process.exit(1);
  });
}
