// Ingests a translation's USFM/USX files into the verses collection.
//
//   npm run ingest -w @discern/backend -- --translation WEB --source ./corpus/eng-web_usfm
//   npm run ingest -w @discern/backend -- --translation KJV --source ./corpus/kjv/EPH.usfm
//
// The source is a LOCAL PATH, never a URL. ARCHITECTURE.md §5 names ebible.org
// as where WEB and KJV come from and says to verify the download and its terms
// by hand — so this script deliberately cannot fetch anything. It reads what it
// is pointed at, whether that is one book file or a directory of them.
//
// IDEMPOTENT. Every verse upserts on { translationId, bookSlug, chapter, verse },
// the unique index from ARCHITECTURE.md §6, so re-running after a corrected
// source file updates text in place rather than duplicating a book. That matters
// because the first ingestion of a translation is rarely the last.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { bookByUsfmId } from "@discern/shared";
import type { AnyBulkWriteOperation } from "mongoose";

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import type { VerseDocument } from "../models";
import { TranslationModel, VerseModel } from "../models";
import type { ParsedBook } from "../services/corpus/parse-usfm";
import { parseUsfm } from "../services/corpus/parse-usfm";
import { parseUsx } from "../services/corpus/parse-usx";

const USFM_EXTENSIONS = new Set([".usfm", ".sfm"]);
const USX_EXTENSIONS = new Set([".usx", ".xml"]);

interface Args {
  translation: string;
  source: string;
  /** Only ingest these book slugs. Useful for a partial or trial run. */
  only?: string[];
  /**
   * Provenance, recorded on the translation document.
   *
   * Public domain is a claim about a specific EDITION, not about a title.
   * eBible.org ships a "2020 stable text edition" of the WEB and a KJV using the
   * standardized text of 1769 — those are the things being ingested, and a year
   * from now "which edition is in this database" has to be answerable from the
   * database. The checksum is what ties the archived licence file in
   * scripts/corpus-licences/ to the exact bytes that were parsed.
   */
  sourceUrl?: string;
  archive?: string;
  archiveSha256?: string;
  licenceFile?: string;
  downloadedAt?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = "true";
    }
  }

  const translation = args.translation ?? args.t;
  const source = args.source ?? args.s;

  if (!translation || !source) {
    throw new Error(
      [
        "Usage:",
        "  ingest-bible --translation <ABBREVIATION> --source <path> [--only <slug,slug>]",
        "",
        "  --translation  Abbreviation of a translation already seeded by seed-corpus (WEB, KJV).",
        "  --source       A LOCAL path: either a directory of USFM/USX files or a single file.",
        "  --only         Optional comma-separated book slugs, e.g. --only ephesians,philippians",
        "",
        "  Provenance (recorded on the translation, so the ingested EDITION is",
        "  answerable from the database a year from now):",
        "  --source-url      Where the archive came from.",
        "  --archive         Archive filename.",
        "  --archive-sha256  Checksum of the archive, tying it to the kept licence file.",
        "  --licence-file    Repo path of the licence kept from inside the archive.",
        "  --downloaded-at   ISO date. Defaults to now.",
        "",
        "  Source files are supplied by hand. This script never downloads anything;",
        "  see ARCHITECTURE.md §5 on verifying the source and its licence terms.",
      ].join("\n"),
    );
  }

  return {
    translation: translation.toUpperCase(),
    source,
    ...(args.only ? { only: args.only.split(",").map((slug) => slug.trim()) } : {}),
    ...(args["source-url"] ? { sourceUrl: args["source-url"] } : {}),
    ...(args.archive ? { archive: args.archive } : {}),
    ...(args["archive-sha256"] ? { archiveSha256: args["archive-sha256"] } : {}),
    ...(args["licence-file"] ? { licenceFile: args["licence-file"] } : {}),
    ...(args["downloaded-at"] ? { downloadedAt: args["downloaded-at"] } : {}),
  };
}

async function collectSourceFiles(source: string): Promise<string[]> {
  const info = await stat(source).catch(() => null);

  if (!info) {
    throw new Error(`Source path does not exist: ${source}`);
  }

  if (info.isFile()) return [source];

  const entries = await readdir(source, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(source, entry.name))
    .filter((file) => {
      const extension = path.extname(file).toLowerCase();
      return USFM_EXTENSIONS.has(extension) || USX_EXTENSIONS.has(extension);
    })
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No .usfm, .sfm, .usx or .xml files found in ${source}. Point --source at ` +
        "the directory containing the book files, or at a single file.",
    );
  }

  return files;
}

function parseFile(file: string, contents: string): ParsedBook {
  const extension = path.extname(file).toLowerCase();

  if (USX_EXTENSIONS.has(extension)) {
    // Some publishers ship .xml that is really USFM, and vice versa. Trust the
    // content over the extension rather than failing on a naming choice.
    return contents.trimStart().startsWith("<")
      ? parseUsx(contents)
      : parseUsfm(contents);
  }

  return parseUsfm(contents);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  assertCorpusWritable("ingest-bible");

  const translation = await TranslationModel.findOne({
    abbreviation: args.translation,
  });

  if (!translation) {
    throw new Error(
      `Translation "${args.translation}" is not in the database. Run the seed ` +
        "script first: npm run seed -w @discern/backend",
    );
  }

  // Stamp provenance BEFORE parsing: if ingestion fails partway, the record of
  // what was being ingested should still exist.
  if (args.sourceUrl && args.archive && args.archiveSha256 && args.licenceFile) {
    const downloadedAt = args.downloadedAt ? new Date(args.downloadedAt) : new Date();

    if (Number.isNaN(downloadedAt.getTime())) {
      throw new Error(`--downloaded-at is not a valid date: ${args.downloadedAt}`);
    }

    translation.set("source", {
      url: args.sourceUrl,
      archive: args.archive,
      sha256: args.archiveSha256,
      downloadedAt,
      licenceFile: args.licenceFile,
    });
    await translation.save();

    logger.info(
      {
        translation: args.translation,
        url: args.sourceUrl,
        archive: args.archive,
        sha256: args.archiveSha256.slice(0, 16) + "...",
        licenceFile: args.licenceFile,
      },
      "provenance recorded",
    );
  } else if (args.sourceUrl || args.archive || args.archiveSha256) {
    // Half a provenance record is worse than none: it looks authoritative and
    // cannot be verified.
    logger.warn(
      "provenance NOT recorded: --source-url, --archive, --archive-sha256 and " +
        "--licence-file must all be supplied together",
    );
  }

  const files = await collectSourceFiles(args.source);

  logger.info(
    { translation: args.translation, files: files.length, source: args.source },
    "ingestion starting",
  );

  let booksIngested = 0;
  let versesWritten = 0;
  const skipped: string[] = [];

  for (const [index, file] of files.entries()) {
    const contents = await readFile(file, "utf8");

    let parsed: ParsedBook;
    try {
      parsed = parseFile(file, contents);
    } catch (error) {
      // A single unreadable file must not abandon a 66-book run.
      logger.warn(
        { file: path.basename(file), err: error },
        "could not parse file, skipping",
      );
      skipped.push(path.basename(file));
      continue;
    }

    const book = bookByUsfmId(parsed.usfmId);

    if (!book) {
      // Deuterocanonical books and front/back matter live alongside the 66 in
      // most distributions. Skipping them quietly is correct, not a failure.
      logger.debug(
        { file: path.basename(file), usfmId: parsed.usfmId },
        "not a canonical book, skipping",
      );
      skipped.push(`${path.basename(file)} (${parsed.usfmId})`);
      continue;
    }

    if (args.only && !args.only.includes(book.slug)) continue;

    if (parsed.verses.length === 0) {
      logger.warn({ book: book.slug, file: path.basename(file) }, "no verses parsed");
      skipped.push(`${book.slug} (empty)`);
      continue;
    }

    const operations: AnyBulkWriteOperation<VerseDocument>[] = parsed.verses.map(
      (verse) => ({
        updateOne: {
          filter: {
            translationId: translation._id,
            bookSlug: book.slug,
            chapter: verse.chapter,
            verse: verse.verse,
          },
          update: { $set: { text: verse.text } },
          upsert: true,
        },
      }),
    );

    const result = await VerseModel.bulkWrite(operations, { ordered: false });

    booksIngested += 1;
    versesWritten += parsed.verses.length;

    const highestChapter = Math.max(...parsed.verses.map((v) => v.chapter));

    logger.info(
      {
        progress: `${index + 1}/${files.length}`,
        book: book.slug,
        chapters: highestChapter,
        verses: parsed.verses.length,
        inserted: result.upsertedCount,
        updated: result.modifiedCount,
      },
      "book ingested",
    );

    // A book whose parsed chapter count disagrees with the canonical one is the
    // signal that a parser assumption broke. Loud, but not fatal: partial data
    // is still better than none, and the number makes the problem findable.
    if (highestChapter !== book.chapterCount) {
      logger.warn(
        {
          book: book.slug,
          parsedChapters: highestChapter,
          expectedChapters: book.chapterCount,
        },
        "chapter count does not match the canonical table",
      );
    }
  }

  logger.info(
    {
      translation: args.translation,
      books: booksIngested,
      verses: versesWritten,
      skipped: skipped.length,
    },
    "ingestion complete",
  );

  if (skipped.length > 0) {
    logger.info({ skipped: skipped.join(", ") }, "skipped files");
  }

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "ingestion failed",
    );
    process.exit(1);
  });
}
