// Scripture reference parsing.
//
// Every accepted form resolves to the same structure:
//
//   "Ephesians 2:8-10"     book + chapter + verse range
//   "Eph 2:8-10"           any alias from the shared book table
//   "John 3:16"            single verse
//   "Matthew 9:35-10:4"    cross-chapter range
//   "Psalm 23"             whole chapter
//   "Jude 4"               verse 4 — Jude has ONE chapter, see below
//
// Garbage produces a ValidationError with a message naming what was wrong, so
// the route returns 400 rather than a 500 from something downstream trying to
// query with NaN.

import { bookByAnyName, type BookMeta } from "@discern/shared";

import { ValidationError } from "./errors";

export interface ParsedReference {
  book: BookMeta;
  startChapter: number;
  /** Absent means the whole chapter was requested. */
  startVerse?: number;
  endChapter: number;
  endVerse?: number;
  /** Whether the input named no verses at all. */
  isWholeChapter: boolean;
  /** Normalised display form, always using the book's full name. */
  canonical: string;
}

/**
 * `<book> <n>[:<n>][ - [<n>:]<n> ]`
 *
 * The book group is non-greedy so a leading numeral binds to the BOOK rather
 * than being read as a chapter: in "1 John 3:16" the parser first tries book="1",
 * fails to find a chapter in "John", backtracks, and settles on book="1 John".
 *
 * Both ASCII hyphen and en dash are accepted — an en dash is what you get when a
 * reference is pasted out of anything that has been through a word processor.
 */
const REFERENCE_PATTERN =
  /^(.+?)\s*(\d+)(?::(\d+))?(?:\s*[-–—]\s*(?:(\d+)\s*:\s*)?(\d+))?$/;

function fail(input: string, reason: string): never {
  throw new ValidationError(`Could not parse reference "${input}": ${reason}`, {
    reference: input,
    reason,
  });
}

export function parseReference(rawInput: string): ParsedReference {
  // Routes receive this as a path parameter, so it arrives percent-encoded and
  // may carry the + -> space convention from a query string.
  let input: string;
  try {
    input = decodeURIComponent(rawInput.replace(/\+/g, " ")).trim();
  } catch {
    input = rawInput.trim();
  }

  if (!input) {
    fail(rawInput, "it is empty.");
  }

  const match = REFERENCE_PATTERN.exec(input);

  if (!match) {
    // The common case here is a book name with no numbers at all ("Ephesians"),
    // which is a legitimate thing to type and worth naming precisely.
    const book = bookByAnyName(input);
    if (book) {
      fail(
        input,
        `"${book.name}" names a book but no chapter. Try "${book.name} 1".`,
      );
    }
    fail(input, "expected a form like \"Ephesians 2:8-10\" or \"John 3:16\".");
  }

  const [, bookPart, firstNumber, secondNumber, rangeChapter, rangeVerse] =
    match as unknown as [
      string,
      string,
      string,
      string | undefined,
      string | undefined,
      string | undefined,
    ];

  const book = bookByAnyName(bookPart);

  if (!book) {
    fail(input, `"${bookPart.trim()}" is not a book of the Bible.`);
  }

  // Single-chapter books: Obadiah, Philemon, 2 John, 3 John, Jude.
  //
  // "Jude 4" means VERSE 4, not chapter 4 — nobody writing it means the fourth
  // chapter of a book that has one. Reading it as a chapter would 404 on a
  // reference that is both common and correct.
  const singleChapterBook = book.chapterCount === 1;

  let startChapter: number;
  let startVerse: number | undefined;

  if (singleChapterBook && secondNumber === undefined) {
    startChapter = 1;
    startVerse = Number(firstNumber);
  } else {
    startChapter = Number(firstNumber);
    startVerse = secondNumber === undefined ? undefined : Number(secondNumber);
  }

  if (startChapter < 1 || startChapter > book.chapterCount) {
    fail(
      input,
      `${book.name} has ${book.chapterCount} chapter${
        book.chapterCount === 1 ? "" : "s"
      }, so chapter ${startChapter} does not exist.`,
    );
  }

  const isWholeChapter = startVerse === undefined;

  let endChapter = startChapter;
  let endVerse = startVerse;

  if (rangeVerse !== undefined) {
    if (isWholeChapter) {
      // "Psalm 23-24" — a chapter RANGE. Deliberately unsupported: a passage is
      // a pericope, and a multi-chapter span is a reading plan, not something to
      // be handed to someone to sit with.
      fail(
        input,
        "chapter ranges are not supported. Name verses, as in " +
          `"${book.name} ${startChapter}:1-10".`,
      );
    }

    endChapter = rangeChapter === undefined ? startChapter : Number(rangeChapter);
    endVerse = Number(rangeVerse);

    if (endChapter > book.chapterCount) {
      fail(
        input,
        `${book.name} has ${book.chapterCount} chapters, so chapter ` +
          `${endChapter} does not exist.`,
      );
    }

    if (endChapter < startChapter) {
      fail(input, "the range ends in an earlier chapter than it begins.");
    }

    if (endChapter === startChapter && endVerse < (startVerse ?? 1)) {
      fail(input, "the range ends before it begins.");
    }
  }

  return {
    book,
    startChapter,
    ...(startVerse === undefined ? {} : { startVerse }),
    endChapter,
    ...(endVerse === undefined ? {} : { endVerse }),
    isWholeChapter,
    canonical: formatReference({
      bookName: book.name,
      startChapter,
      startVerse,
      endChapter,
      endVerse,
    }),
  };
}

/** The one place a reference string is built, so stored and parsed forms match. */
export function formatReference(parts: {
  bookName: string;
  startChapter: number;
  startVerse?: number | undefined;
  endChapter: number;
  endVerse?: number | undefined;
}): string {
  const { bookName, startChapter, startVerse, endChapter, endVerse } = parts;

  if (startVerse === undefined) {
    return `${bookName} ${startChapter}`;
  }

  if (endVerse === undefined || (endChapter === startChapter && endVerse === startVerse)) {
    return `${bookName} ${startChapter}:${startVerse}`;
  }

  if (endChapter === startChapter) {
    return `${bookName} ${startChapter}:${startVerse}-${endVerse}`;
  }

  return `${bookName} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
}
