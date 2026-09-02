// Seeds translations, authors and books.
//
//   npm run seed -w @discern/backend
//
// Idempotent: every write is an upsert keyed on a natural unique field, so
// re-running it updates prose (an improved `circumstances`, a clearer
// attribution note) without duplicating anything or orphaning verse data.
//
// Verses are NOT seeded here — they come from ingest-bible.ts, which needs
// source files. This script establishes everything those files hang off.

import { BOOKS } from "@discern/shared";

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { AuthorModel, BookModel, TranslationModel } from "../models";
import { AUTHOR_SEEDS } from "./data/authors";

/**
 * ARCHITECTURE.md §5 and §10 decision 5: launch on WEB + KJV.
 *
 * Both are public domain, which is what makes them shippable now with no legal
 * work. WEB is the default because it is modern readable English — it removes
 * the "KJV is too hard" problem at zero cost — while KJV stays available for
 * people who want it and because the brand chapter is quoted from it.
 */
const TRANSLATION_SEEDS = [
  {
    abbreviation: "WEB",
    name: "World English Bible",
    licenseType: "public-domain" as const,
    // Taken from the copr.htm shipped inside eng-web_usfm.zip, kept verbatim at
    // scripts/corpus-licences/eng-web.copr.htm. Two conditions worth carrying:
    // the NAME is a trademark of eBible.org even though the text is not
    // copyrighted, and modified text may not still be called the World English
    // Bible. Neither restricts what Discern does, but both are worth not
    // discovering later.
    copyrightNotice:
      "The World English Bible is in the public domain (2020 stable text edition). " +
      '"World English Bible" is a trademark of eBible.org; modified text may not be ' +
      "distributed under that name.",
    isDefault: true,
  },
  {
    abbreviation: "KJV",
    name: "King James Version",
    licenseType: "public-domain" as const,
    // NOT unqualified public domain everywhere. The copr.htm shipped inside
    // eng-kjv_usfm.zip records that letters patent issued by King James, with no
    // expiration, still restrict PRINTING this translation in the United Kingdom
    // or importing printed copies into it — Cambridge University Press, Oxford
    // University Press and Collins hold that right. The patent has no effect
    // outside the UK, where the text is firmly public domain.
    //
    // Distributing an app containing the text is not printing, so this does not
    // block a UK App Store release; it is recorded because a printed Discern
    // artefact sold into the UK would be a different question.
    copyrightNotice:
      "The King James Version (standardized text of 1769) is in the public domain. " +
      "Note: letters patent restrict the PRINTING of this translation within the " +
      "United Kingdom, where Cambridge University Press, Oxford University Press " +
      "and Collins hold that right. The patent has no effect outside the UK.",
    isDefault: false,
  },
];

async function seedTranslations(): Promise<void> {
  for (const seed of TRANSLATION_SEEDS) {
    await TranslationModel.updateOne(
      { abbreviation: seed.abbreviation },
      { $set: seed },
      { upsert: true },
    );
  }

  logger.info({ count: TRANSLATION_SEEDS.length }, "translations seeded");
}

async function seedAuthors(): Promise<Map<string, string>> {
  const byBookSlug = new Map<string, string>();

  for (const seed of AUTHOR_SEEDS) {
    // findOneAndUpdate rather than updateOne: the pre('validate') hook that
    // requires a note for contested authorship only runs on a document, and the
    // returned _id is needed to link books below.
    const author = await AuthorModel.findOneAndUpdate(
      { slug: seed.slug },
      { $set: seed },
      { upsert: true, new: true, runValidators: true },
    );

    if (!author) {
      throw new Error(`Failed to upsert author "${seed.slug}"`);
    }

    for (const bookSlug of seed.bookSlugs) {
      byBookSlug.set(bookSlug, author.id as string);
    }
  }

  const contested = AUTHOR_SEEDS.filter(
    (seed) => seed.attribution !== "traditional",
  );

  logger.info(
    {
      count: AUTHOR_SEEDS.length,
      contested: contested.length,
      contestedSlugs: contested.map((seed) => seed.slug).join(","),
    },
    "authors seeded",
  );

  return byBookSlug;
}

async function seedBooks(authorIdByBookSlug: Map<string, string>): Promise<void> {
  const unlinked: string[] = [];

  for (const book of BOOKS) {
    const authorId = authorIdByBookSlug.get(book.slug) ?? null;
    if (!authorId) unlinked.push(book.slug);

    await BookModel.updateOne(
      { slug: book.slug },
      {
        $set: {
          slug: book.slug,
          name: book.name,
          testament: book.testament,
          canonicalOrder: book.canonicalOrder,
          chapterCount: book.chapterCount,
          authorId,
        },
      },
      { upsert: true },
    );
  }

  logger.info({ count: BOOKS.length }, "books seeded");

  // Every book should map to an author document, including the anonymous ones —
  // those have a "The author of X" entry precisely so the reader still gets
  // circumstances. An unlinked book means the seed data has a gap.
  if (unlinked.length > 0) {
    logger.warn(
      { books: unlinked.join(","), count: unlinked.length },
      "books with no author document",
    );
  }
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertCorpusWritable("seed-corpus");

  await seedTranslations();
  const authorIdByBookSlug = await seedAuthors();
  await seedBooks(authorIdByBookSlug);

  const coverage = new Set(AUTHOR_SEEDS.flatMap((seed) => seed.bookSlugs));
  logger.info(
    { booksCovered: coverage.size, booksTotal: BOOKS.length },
    "corpus seed complete",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, "seed failed");
    process.exit(1);
  });
}
