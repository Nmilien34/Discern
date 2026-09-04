// SAYING A REFERENCE OUT LOUD.
//
// "Ephesians 2:8-10" read literally by a TTS engine comes out as "Ephesians
// two colon eight dash ten", which is how nobody has ever said it. A person
// says "Ephesians chapter two, verses eight through ten", and that difference
// is most of what makes a synthesized voice sound like a machine reading a
// citation rather than someone who knows the text.
//
// DERIVED, NOT LISTED. There are no reference strings in this file. It parses
// the reference structurally and reads the canonical BOOKS table for the book's
// spoken form, its leading numeral, and whether it has chapters at all. A new
// book, or a name that reads wrongly, is a data change in books.ts — the same
// table that fixed referencedPassages() when it was guessing at capitalisation.
//
// SPEECH PATH ONLY. The written reply keeps normal citation formatting; this
// runs between her text and the synthesizer.

import { BOOKS } from "@discern/shared";

import { parseReference } from "../../lib/reference";

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];

const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
];

/** Cardinals up to 999. Psalm 119 and its 176 verses are the ceiling here. */
function spellNumber(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);

  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)] ?? "";
    const ones = n % 10;
    return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
  }

  const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} ${spellNumber(rest)}`;
}

/**
 * The book, said aloud.
 *
 * A leading numeral is an ORDINAL when spoken — "First Corinthians", never
 * "one Corinthians" and never "1 Corinthians" — and that is derived from the
 * name rather than listed, so 1/2 Samuel, Kings, Chronicles, Corinthians,
 * Thessalonians, Timothy, Peter and John all fall out of one rule.
 */
function spokenBookName(name: string, spokenOverride?: string): string {
  const base = spokenOverride ?? name;
  const numbered = /^([123])\s+(.+)$/.exec(base);

  if (!numbered) return base;

  const ordinal = { "1": "First", "2": "Second", "3": "Third" }[numbered[1] ?? ""];

  return ordinal ? `${ordinal} ${numbered[2]}` : base;
}

/**
 * Turn one reference into how a person says it, or null if it is not one.
 *
 * Shapes it produces, all from the same rule:
 *   Ephesians 2:8-10   -> Ephesians chapter two, verses eight through ten
 *   Psalms 27:1        -> Psalm twenty-seven, verse one
 *   1 Corinthians 13   -> First Corinthians, chapter thirteen
 *   Jude 3             -> Jude, verse three          (chapterCount 1)
 */
export function speakReference(raw: string): string | null {
  let parsed;

  try {
    parsed = parseReference(raw);
  } catch {
    return null;
  }

  const book = spokenBookName(parsed.book.name, parsed.book.spokenName);

  // "chapter" unless the book says otherwise. Psalms says otherwise: the
  // number is the psalm, so "Psalm twenty-seven" and not "Psalm chapter
  // twenty-seven". undefined means "not specified", null means "none".
  const chapterWord =
    parsed.book.spokenChapterWord === undefined
      ? "chapter"
      : parsed.book.spokenChapterWord;

  const withChapter = (n: number): string =>
    chapterWord ? `${book} ${chapterWord} ${spellNumber(n)}` : `${book} ${spellNumber(n)}`;

  // A single-chapter book has no chapter to name. "Jude chapter one, verse
  // three" is how a search index says it; a person says "Jude, verse three".
  const singleChapter = parsed.book.chapterCount === 1;

  if (parsed.isWholeChapter) {
    if (singleChapter) return book;

    return parsed.endChapter !== parsed.startChapter
      ? `${withChapter(parsed.startChapter)} through ${spellNumber(parsed.endChapter)}`
      : withChapter(parsed.startChapter);
  }

  const start = parsed.startVerse ?? 1;
  const end = parsed.endVerse ?? start;
  const crossesChapters = parsed.endChapter !== parsed.startChapter;

  const chapterPart = singleChapter ? book : withChapter(parsed.startChapter);

  if (crossesChapters) {
    // "2 Samuel chapter eleven verse one, through chapter twelve verse
    // twenty-five" — long, but a shorter form would be ambiguous.
    return (
      `${chapterPart} verse ${spellNumber(start)}, through ` +
      `${chapterWord ? `${chapterWord} ` : ""}${spellNumber(parsed.endChapter)} ` +
      `verse ${spellNumber(end)}`
    );
  }

  if (end !== start) {
    return `${chapterPart}, verses ${spellNumber(start)} through ${spellNumber(end)}`;
  }

  return `${chapterPart}, verse ${spellNumber(start)}`;
}

/**
 * Every book name and alias that can begin a reference, longest first.
 *
 * Longest-first matters: "Song of Solomon" must be tried before "Song", and
 * "1 Corinthians" before "Corinthians".
 */
const BOOK_PATTERN = [...BOOKS]
  .flatMap((b) => [b.name, ...b.aliases])
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const REFERENCE_IN_PROSE = new RegExp(
  `\\b(?:${BOOK_PATTERN})\\.?\\s+\\d+(?::\\d+)?(?:\\s*[-–—]\\s*(?:\\d+:)?\\d+)?`,
  "gi",
);

/**
 * Rewrite every reference inside a passage of prose for speech.
 *
 * Runs on the speech path only. What is on screen is untouched.
 */
export function speakableProse(text: string): string {
  return text.replace(REFERENCE_IN_PROSE, (match) => speakReference(match) ?? match);
}
