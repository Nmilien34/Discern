// USFM parsing.
//
// USFM is the format ebible.org publishes WEB and KJV in (ARCHITECTURE.md §5).
// It is line-based markup: `\marker content`, where some markers are structural
// (`\c 1`, `\v 3`), some are formatting we do not want (`\p`, `\q1`), and some
// wrap inline text that we DO want to keep (`\nd Yahweh\nd*`).
//
// Three details cause almost all the damage if missed:
//
//  1. Footnotes and cross references (`\f ... \f*`, `\x ... \x*`) contain prose
//     that reads like scripture but is not. Left in, they end up inside a verse
//     and then inside an embedding, and Abigail hands somebody a footnote.
//  2. Verse text continues across following lines until the next `\v` or `\c`.
//     Parsing line-by-line and stopping at the newline truncates most poetry.
//  3. `\w word|strong="H1234"\w*` carries lexical attributes after a pipe. The
//     word is wanted; the attributes are not.

export interface ParsedVerse {
  chapter: number;
  verse: number;
  text: string;
}

export interface ParsedBook {
  /** The three-character USFM book id from `\id`, e.g. "EPH". */
  usfmId: string;
  verses: ParsedVerse[];
}

/**
 * Removes note content entirely, including the markers around it.
 *
 * Non-greedy to the matching close so consecutive notes do not swallow the
 * verse text between them.
 */
function stripNotes(source: string): string {
  return source
    .replace(/\\f\s.*?\\f\*/gs, " ")
    .replace(/\\x\s.*?\\x\*/gs, " ")
    // Some files use \fe (endnotes) and \ef (extended footnotes).
    .replace(/\\fe\s.*?\\fe\*/gs, " ")
    .replace(/\\ef\s.*?\\ef\*/gs, " ");
}

/**
 * Collapses whitespace and repairs the space a removed marker leaves behind.
 *
 * Markers are replaced with a space rather than nothing, because `word\nd*more`
 * must not become "wordmore". The cost is a space before punctuation whenever a
 * marker closes at the end of a sentence — `\wj I am\wj*.` becoming "I am ." —
 * and `\wj` wraps the words of Jesus, so without this repair the artefact runs
 * through most of the Gospels.
 */
export function tidyWhitespace(source: string): string {
  return source
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]}»”’])/g, "$1")
    .replace(/([([{«“‘])\s+/g, "$1")
    .trim();
}

/** Strips inline markup while keeping the words it wraps. */
export function cleanVerseText(source: string): string {
  return tidyWhitespace(
    source
      // \w word|strong="H430" \w*  ->  word
      .replace(/\\\+?w\s+([^|\\]*?)(?:\|[^\\]*?)?\\\+?w\*/g, "$1")
      // Any remaining character or paragraph marker, opening or closing.
      .replace(/\\\+?[a-z]+\d*\*?/g, " ")
      // USFM uses ~ for a non-breaking space and // for a discretionary break.
      .replace(/~/g, " ")
      .replace(/\/\//g, " "),
  );
}

/**
 * Verse numbers are not always integers.
 *
 * `\v 1-2` marks a merged verse and `\v 6a` a partial one. Both are anchored to
 * their first integer: a merged verse is stored once at its start number rather
 * than duplicated or dropped.
 */
function parseVerseNumber(raw: string): number | null {
  const match = /^(\d+)/.exec(raw);
  return match?.[1] ? Number(match[1]) : null;
}

export function parseUsfm(source: string): ParsedBook {
  const idMatch = /\\id\s+(\w{3})/.exec(source);

  if (!idMatch?.[1]) {
    throw new Error(
      "No \\id marker found. A USFM book file must begin with a line like " +
        "`\\id EPH` naming the book.",
    );
  }

  const usfmId = idMatch[1].toUpperCase();
  const cleaned = stripNotes(source);
  const verses: ParsedVerse[] = [];

  // One pass over every \c and \v marker. Text belonging to a verse is
  // everything between its marker and the next one of either kind, which is what
  // makes multi-line poetry come through whole.
  const markers = [...cleaned.matchAll(/\\(c|v)\s+(\S+)/g)];

  let chapter = 0;

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (!marker) continue;

    const kind = marker[1];
    const value = marker[2] ?? "";

    if (kind === "c") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) chapter = parsed;
      continue;
    }

    const verseNumber = parseVerseNumber(value);
    if (verseNumber === null || chapter === 0) continue;

    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? cleaned.length;
    const text = cleanVerseText(cleaned.slice(start, end));

    // An empty verse is a parsing artefact, not scripture. Skipping it keeps
    // segmentation from producing a passage with a hole in it.
    if (text) {
      verses.push({ chapter, verse: verseNumber, text });
    }
  }

  return { usfmId, verses };
}
