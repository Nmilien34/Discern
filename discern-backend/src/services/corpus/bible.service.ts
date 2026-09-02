// Read side of the corpus: authors, chapters and passages.
//
// Author-first navigation is a CORE FEATURE, not a filter (Phase 2 brief), which
// is why getAuthor returns the person — bio, era, circumstances, and an honest
// attribution — rather than a list of books with a name attached.

import type {
  AuthorDetail,
  AuthorSummary,
  ChapterResponse,
  PassageResponse,
  Translation,
} from "@discern/shared";
import { bookBySlug } from "@discern/shared";
import type { Types } from "mongoose";

import { NotFoundError, ValidationError } from "../../lib/errors";
import { formatReference, parseReference } from "../../lib/reference";
import type { AuthorDocument, TranslationDocument } from "../../models";
import {
  AuthorModel,
  BookModel,
  PassageModel,
  TranslationModel,
  VerseModel,
} from "../../models";

function toAuthorSummary(author: AuthorDocument): AuthorSummary {
  return {
    id: author.id as string,
    slug: author.slug,
    name: author.name,
    era: author.era,
    attribution: author.attribution,
    ...(author.attributionNote ? { attributionNote: author.attributionNote } : {}),
    bookSlugs: author.bookSlugs,
  };
}

function toTranslation(translation: TranslationDocument): Translation {
  return {
    id: translation.id as string,
    abbreviation: translation.abbreviation,
    name: translation.name,
    licenseType: translation.licenseType,
    copyrightNotice: translation.copyrightNotice,
    isDefault: translation.isDefault,
    // Provenance travels with the translation: public domain is a claim about a
    // specific edition, and the reader screen should be able to say which one.
    ...(translation.source
      ? {
          source: {
            url: translation.source.url,
            archive: translation.source.archive,
            sha256: translation.source.sha256,
            downloadedAt: translation.source.downloadedAt.toISOString(),
            licenceFile: translation.source.licenceFile,
          },
        }
      : {}),
  };
}

/**
 * Resolves `?translation=KJV`, falling back to the default translation.
 *
 * An unknown abbreviation is a ValidationError listing what is available, not a
 * silent fallback: quietly serving WEB to someone who asked for KJV is the kind
 * of wrong that nobody notices until they are reading a verse they did not
 * expect.
 */
export async function resolveTranslation(
  abbreviation?: string,
): Promise<TranslationDocument> {
  if (abbreviation) {
    const requested = await TranslationModel.findOne({
      abbreviation: abbreviation.toUpperCase(),
    });

    if (requested) return requested;

    const available = await TranslationModel.find().sort({ abbreviation: 1 });
    throw new ValidationError(
      `Unknown translation "${abbreviation}".`,
      {
        requested: abbreviation,
        available: available.map((translation) => translation.abbreviation),
      },
    );
  }

  const fallback =
    (await TranslationModel.findOne({ isDefault: true })) ??
    (await TranslationModel.findOne());

  if (!fallback) {
    throw new NotFoundError(
      "No translations have been seeded. Run: npm run seed -w @discern/backend",
    );
  }

  return fallback;
}

export async function listAuthors(): Promise<AuthorSummary[]> {
  // Canonical order of each author's FIRST book, so the list reads like the
  // Bible rather than like an alphabetised index.
  const authors = await AuthorModel.find();
  const books = await BookModel.find().sort({ canonicalOrder: 1 });

  const orderByBookSlug = new Map(
    books.map((book) => [book.slug, book.canonicalOrder]),
  );

  const firstBookOrder = (author: AuthorDocument): number =>
    Math.min(
      ...author.bookSlugs.map((slug) => orderByBookSlug.get(slug) ?? 999),
      999,
    );

  return authors
    .sort((a, b) => firstBookOrder(a) - firstBookOrder(b))
    .map(toAuthorSummary);
}

export async function getAuthorBySlug(slug: string): Promise<AuthorDetail> {
  const author = await AuthorModel.findOne({ slug: slug.toLowerCase() });

  if (!author) {
    throw new NotFoundError(`No author with slug "${slug}".`);
  }

  const books = await BookModel.find({ slug: { $in: author.bookSlugs } }).sort({
    canonicalOrder: 1,
  });

  return {
    ...toAuthorSummary(author),
    bio: author.bio,
    circumstances: author.circumstances,
    books: books.map((book) => ({
      slug: book.slug,
      name: book.name,
      testament: book.testament,
      canonicalOrder: book.canonicalOrder,
      chapterCount: book.chapterCount,
    })),
  };
}

export async function getChapter(
  bookSlug: string,
  chapter: number,
  translationAbbreviation?: string,
): Promise<ChapterResponse> {
  const meta = bookBySlug(bookSlug.toLowerCase());

  if (!meta) {
    throw new NotFoundError(`No book with slug "${bookSlug}".`);
  }

  if (!Number.isInteger(chapter) || chapter < 1 || chapter > meta.chapterCount) {
    throw new ValidationError(
      `${meta.name} has ${meta.chapterCount} chapter${
        meta.chapterCount === 1 ? "" : "s"
      }, so chapter ${chapter} does not exist.`,
      { book: meta.slug, requested: chapter, chapterCount: meta.chapterCount },
    );
  }

  const translation = await resolveTranslation(translationAbbreviation);

  const verses = await VerseModel.find({
    translationId: translation._id,
    bookSlug: meta.slug,
    chapter,
  })
    .sort({ verse: 1 })
    .lean();

  if (verses.length === 0) {
    throw new NotFoundError(
      `${meta.name} ${chapter} has not been ingested for ${translation.abbreviation}.`,
    );
  }

  const book = await BookModel.findOne({ slug: meta.slug });
  const author = book?.authorId
    ? await AuthorModel.findById(book.authorId)
    : null;

  return {
    book: {
      slug: meta.slug,
      name: meta.name,
      testament: meta.testament,
      chapterCount: meta.chapterCount,
    },
    author: author ? toAuthorSummary(author) : null,
    translation: toTranslation(translation),
    chapter,
    verses: verses.map((verse) => ({
      chapter: verse.chapter,
      verse: verse.verse,
      text: verse.text,
    })),
  };
}

/** Verses covering a possibly cross-chapter span. */
async function findSpanVerses(
  translationId: Types.ObjectId,
  bookSlug: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number,
) {
  return VerseModel.find({
    translationId,
    bookSlug,
    $or: [
      {
        chapter: startChapter,
        ...(startChapter === endChapter
          ? { verse: { $gte: startVerse, $lte: endVerse } }
          : { verse: { $gte: startVerse } }),
      },
      ...(endChapter > startChapter
        ? [
            { chapter: { $gt: startChapter, $lt: endChapter } },
            { chapter: endChapter, verse: { $lte: endVerse } },
          ]
        : []),
    ],
  })
    .sort({ chapter: 1, verse: 1 })
    .lean();
}

export async function getPassageByReference(
  rawReference: string,
  translationAbbreviation?: string,
): Promise<PassageResponse> {
  // Throws ValidationError on anything unparseable, which is what turns garbage
  // into a 400 rather than a 500 from a query built with NaN.
  const parsed = parseReference(rawReference);
  const translation = await resolveTranslation(translationAbbreviation);

  const meta = parsed.book;

  const startChapter = parsed.startChapter;
  const startVerse = parsed.startVerse ?? 1;
  const endChapter = parsed.endChapter;

  // A whole-chapter reference ends at whatever the last verse turns out to be.
  const endVerse =
    parsed.endVerse ??
    (parsed.isWholeChapter
      ? Number.MAX_SAFE_INTEGER
      : startVerse);

  const verses = await findSpanVerses(
    translation._id,
    meta.slug,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  );

  if (verses.length === 0) {
    throw new NotFoundError(
      `${parsed.canonical} has not been ingested for ${translation.abbreviation}.`,
    );
  }

  const first = verses[0];
  const last = verses[verses.length - 1];

  if (!first || !last) {
    throw new NotFoundError(`${parsed.canonical} returned no verses.`);
  }

  const actualReference = formatReference({
    bookName: meta.name,
    startChapter: first.chapter,
    startVerse: first.verse,
    endChapter: last.chapter,
    endVerse: last.verse,
  });

  // A stored passage is the retrievable unit — embeddable, carryable, returnable
  // by search. An ad-hoc range is assembled on the way out and carries a null id
  // so the caller can tell the difference.
  const stored = await PassageModel.findOne({ reference: actualReference });

  const book = await BookModel.findOne({ slug: meta.slug });
  const author = book?.authorId ? await AuthorModel.findById(book.authorId) : null;

  return {
    id: stored ? (stored.id as string) : null,
    reference: actualReference,
    bookSlug: meta.slug,
    bookName: meta.name,
    chapter: first.chapter,
    startVerse: first.verse,
    endVerse: last.verse,
    endChapter: last.chapter,
    translation: toTranslation(translation),
    text: verses.map((verse) => verse.text).join(" "),
    verses: verses.map((verse) => ({
      chapter: verse.chapter,
      verse: verse.verse,
      text: verse.text,
    })),
    author: author ? toAuthorSummary(author) : null,
    themes: stored?.themes ?? [],
    stageSlugs: stored?.stageSlugs ?? [],
    situations: stored?.situations ?? [],
    ...(stored?.textualNote ? { textualNote: stored.textualNote } : {}),
  };
}
