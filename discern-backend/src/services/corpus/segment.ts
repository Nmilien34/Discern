// Grouping verses into passages.
//
// A passage is the retrievable unit and the thing a person is handed to sit
// with, so a boundary in the wrong place is not a cosmetic problem: it retrieves
// badly, and it reads worse. "Fixed-size chunks of N verses" is exactly the
// failure to avoid — it cuts mid-sentence, splits a parable from its
// explanation, and strands a conclusion from the argument it concludes.
//
// Three strategies, in order of authority:
//
//  1. CURATED. Where a unit is well established, it is written down
//     (scripts/data/pericopes.ts) and used verbatim. Nothing beats knowing.
//  2. WHOLE-UNIT BY RULE. A psalm is a poem; it is already the unit. A
//     single-chapter book likewise has an obvious shape.
//  3. DISCOURSE-AWARE. Everywhere else, break within a size band at the most
//     plausible boundary, judged by how the next verse OPENS. English
//     translations preserve discourse markers well enough for this to beat
//     arbitrary windowing by a wide margin, and it never breaks before a verse
//     that is grammatically continuing the previous one.

import type { PericopeRange } from "../../scripts/data/pericopes";
import { CURATED_PERICOPES } from "../../scripts/data/pericopes";

export interface SegmentInputVerse {
  chapter: number;
  verse: number;
  text: string;
}

export interface PassageBoundary {
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  verses: SegmentInputVerse[];
  source: "curated" | "whole-chapter" | "discourse";
  /** Only from a curated entry that supplied one. Travels onto the passage. */
  note?: string;
}

/**
 * Finds curated ranges that overlap each other within a book.
 *
 * Two curated ranges claiming the same verse is silent corruption: the verse
 * lands in two passages, coverage stops being a partition, and retrieval can
 * return the same words twice under different references. It is easy to
 * introduce — adding "Ephesians 5:21-6:9" beside an existing "Ephesians 5:1-21"
 * overlaps at exactly one verse, and nothing about the diff looks wrong.
 *
 * Ran as an assertion by segment-passages.ts, so a bad edit to the table fails
 * before it writes anything rather than after.
 */
export function findCuratedOverlaps(): string[] {
  const problems: string[] = [];

  for (const [bookSlug, ranges] of Object.entries(CURATED_PERICOPES)) {
    const claimed = new Map<string, string>();

    for (const range of ranges) {
      const [startChapter, startVerse, endChapter, endVerse] = range;
      const label = `${startChapter}:${startVerse}-${endChapter}:${endVerse}`;

      // Ranges are bounded by real chapters, so walking them is cheap and needs
      // no verse counts.
      for (let chapter = startChapter; chapter <= endChapter; chapter += 1) {
        const from = chapter === startChapter ? startVerse : 1;
        // 200 comfortably exceeds the longest chapter (Psalm 119, 176 verses).
        const to = chapter === endChapter ? endVerse : 200;

        for (let verse = from; verse <= to; verse += 1) {
          const key = `${chapter}:${verse}`;
          const existing = claimed.get(key);

          if (existing && existing !== label) {
            const message = `${bookSlug}: ${existing} overlaps ${label} at ${key}`;
            if (!problems.includes(message)) problems.push(message);
          } else {
            claimed.set(key, label);
          }
        }
      }
    }
  }

  return problems;
}

/** Target band. Long enough to hold a thought, short enough to sit with. */
const MIN_VERSES = 3;
const MAX_VERSES = 14;
const PREFERRED_VERSES = 8;

/**
 * Openings that signal a NEW unit — a good place to break BEFORE.
 *
 * These are discourse-initial in English translations: a change of scene, of
 * addressee, or a turn from argument to application.
 */
const NEW_UNIT_OPENERS = [
  "therefore",
  "now",
  "then",
  "after this",
  "after these things",
  "at that time",
  "in those days",
  "one day",
  "meanwhile",
  "finally",
  "beloved",
  "brothers",
  "my brothers",
  "dear children",
  "again",
  "behold",
  "listen",
  "hear",
  "when",
  "as",
  "on the next day",
  "the next day",
  "in the beginning",
  "it happened",
  "it came to pass",
];

/**
 * Openings that CONTINUE the previous sentence or clause.
 *
 * Breaking before one of these is the specific mistake that makes a passage read
 * as though it starts mid-argument, so they are penalised rather than merely not
 * rewarded.
 */
const CONTINUATION_OPENERS = [
  "for",
  "and",
  "but",
  "or",
  "so that",
  "because",
  "since",
  "that",
  "who",
  "which",
  "whom",
  "whose",
  "nor",
  "yet",
  "also",
  "even",
  "not",
];

function opensWith(text: string, openers: string[]): boolean {
  const normalized = text.toLowerCase().replace(/^[^a-z]+/, "");
  return openers.some(
    (opener) =>
      normalized === opener ||
      normalized.startsWith(`${opener} `) ||
      normalized.startsWith(`${opener},`),
  );
}

/**
 * How good a break BEFORE this verse would be. Higher is better.
 */
function breakScore(verse: SegmentInputVerse, sizeSoFar: number): number {
  let score = 0;

  if (opensWith(verse.text, NEW_UNIT_OPENERS)) score += 10;
  if (opensWith(verse.text, CONTINUATION_OPENERS)) score -= 8;

  // A verse 1 is a chapter boundary, which is a real if imperfect signal: the
  // divisions are medieval rather than original, but they were made by someone
  // reading for sense.
  if (verse.verse === 1) score += 6;

  // Prefer passages near the preferred length; penalise drift in either
  // direction so the band does not collapse to always-minimum.
  score -= Math.abs(sizeSoFar - PREFERRED_VERSES) * 0.8;

  return score;
}

function toBoundary(
  verses: SegmentInputVerse[],
  source: PassageBoundary["source"],
): PassageBoundary | null {
  const first = verses[0];
  const last = verses[verses.length - 1];
  if (!first || !last) return null;

  return {
    startChapter: first.chapter,
    startVerse: first.verse,
    endChapter: last.chapter,
    endVerse: last.verse,
    verses,
    source,
  };
}

function applyCurated(
  verses: SegmentInputVerse[],
  ranges: readonly PericopeRange[],
): { boundaries: PassageBoundary[]; consumed: Set<string> } {
  const boundaries: PassageBoundary[] = [];
  const consumed = new Set<string>();

  for (const range of ranges) {
    const [startChapter, startVerse, endChapter, endVerse, note] = range;
    const inRange = verses.filter((verse) => {
      const afterStart =
        verse.chapter > startChapter ||
        (verse.chapter === startChapter && verse.verse >= startVerse);
      const beforeEnd =
        verse.chapter < endChapter ||
        (verse.chapter === endChapter && verse.verse <= endVerse);
      return afterStart && beforeEnd;
    });

    // A curated range for a book that has not been fully ingested yet simply
    // does not apply. Silence is right here: a partial ingest is a normal state.
    if (inRange.length === 0) continue;

    const boundary = toBoundary(inRange, "curated");
    if (!boundary) continue;

    boundaries.push(note ? { ...boundary, note } : boundary);
    for (const verse of inRange) consumed.add(`${verse.chapter}:${verse.verse}`);
  }

  return { boundaries, consumed };
}

/** Splits one contiguous, single-chapter run of verses at the best-scoring points. */
function segmentRun(run: SegmentInputVerse[]): PassageBoundary[] {
  const groups: SegmentInputVerse[][] = [];
  let current: SegmentInputVerse[] = [];

  for (let index = 0; index < run.length; index += 1) {
    const verse = run[index];
    if (!verse) continue;

    current.push(verse);

    const remaining = run.length - index - 1;
    const next = run[index + 1];

    if (!next) break;

    const atMax = current.length >= MAX_VERSES;
    const canBreak = current.length >= MIN_VERSES;

    // Never leave a stub: if breaking here would strand fewer than MIN_VERSES,
    // carry on unless we are already at the ceiling.
    const wouldStrand = remaining < MIN_VERSES;

    if (!canBreak) continue;

    if (atMax || (!wouldStrand && breakScore(next, current.length) > 0)) {
      groups.push(current);
      current = [];
    }
  }

  if (current.length > 0) groups.push(current);

  // A run shorter than MIN_VERSES — the tail of a chapter left over after a
  // curated passage, most often — merges BACKWARDS into its neighbour rather
  // than standing alone as a one-verse passage. Merging backwards keeps it
  // inside its own chapter; the alternative, letting it join the next chapter,
  // is what produced boundaries like "Genesis 3:23-4:1", which welds the
  // expulsion from Eden onto the birth of Cain.
  const last = groups[groups.length - 1];
  const previous = groups[groups.length - 2];

  if (
    groups.length >= 2 &&
    last &&
    previous &&
    last.length < MIN_VERSES &&
    previous.length + last.length <= MAX_VERSES + MIN_VERSES
  ) {
    previous.push(...last);
    groups.pop();
  }

  return groups
    .map((group) => toBoundary(group, "discourse"))
    .filter((boundary): boundary is PassageBoundary => boundary !== null);
}

export interface SegmentOptions {
  bookSlug: string;
  chapterCount: number;
}

export function segmentBook(
  verses: SegmentInputVerse[],
  options: SegmentOptions,
): PassageBoundary[] {
  const sorted = [...verses].sort(
    (a, b) => a.chapter - b.chapter || a.verse - b.verse,
  );

  if (sorted.length === 0) return [];

  // A psalm is a complete poem and has been read as one unit for as long as
  // there have been psalms. Splitting Psalm 23 into three passages would be
  // indefensible regardless of what any heuristic scored it.
  if (options.bookSlug === "psalms") {
    const byChapter = new Map<number, SegmentInputVerse[]>();
    for (const verse of sorted) {
      const bucket = byChapter.get(verse.chapter) ?? [];
      bucket.push(verse);
      byChapter.set(verse.chapter, bucket);
    }

    return [...byChapter.values()]
      .map((psalm) => toBoundary(psalm, "whole-chapter"))
      .filter((boundary): boundary is PassageBoundary => boundary !== null);
  }

  const curatedRanges = CURATED_PERICOPES[options.bookSlug] ?? [];
  const { boundaries, consumed } = applyCurated(sorted, curatedRanges);

  // Everything the curated table did not claim is segmented by discourse, in
  // contiguous runs so a curated passage in the middle of a chapter does not
  // cause the verses on either side of it to be joined across the gap.
  let run: SegmentInputVerse[] = [];

  const flush = (): void => {
    if (run.length > 0) {
      boundaries.push(...segmentRun(run));
      run = [];
    }
  };

  let previous: SegmentInputVerse | null = null;

  for (const verse of sorted) {
    if (consumed.has(`${verse.chapter}:${verse.verse}`)) {
      flush();
      previous = verse;
      continue;
    }

    // Break the run at any gap in the verse sequence AND at every chapter
    // boundary.
    //
    // Chapter divisions are medieval rather than original, but they were made by
    // someone reading for sense, and crossing one ACCIDENTALLY is worse than a
    // short passage. The full run produced 244 straddling passages — "Genesis
    // 3:23-4:1", "Genesis 9:28-10:12" — none of them intentional: each was a
    // chapter tail too short to stand alone being absorbed by the next chapter.
    //
    // Passages may still cross a chapter where a real pericope does (Matthew
    // 9:35-10:4), but only from the CURATED table, where the crossing is a
    // decision somebody made rather than a side effect of stub avoidance.
    const contiguous =
      previous !== null &&
      previous.chapter === verse.chapter &&
      previous.verse + 1 === verse.verse;

    if (!contiguous) flush();

    run.push(verse);
    previous = verse;
  }

  flush();

  return boundaries.sort(
    (a, b) =>
      a.startChapter - b.startChapter ||
      a.startVerse - b.startVerse,
  );
}
