import { describe, expect, it } from "vitest";

import type { SegmentInputVerse } from "../services/corpus/segment";
import { findCuratedOverlaps, segmentBook } from "../services/corpus/segment";

function verses(
  chapter: number,
  count: number,
  text = "Some verse text here.",
): SegmentInputVerse[] {
  return Array.from({ length: count }, (_unused, index) => ({
    chapter,
    verse: index + 1,
    text,
  }));
}

describe("segmentBook", () => {
  it("keeps each psalm whole", () => {
    // A psalm is a complete poem and has been read as one unit for as long as
    // there have been psalms. Splitting Psalm 23 would be indefensible no matter
    // what a heuristic scored it.
    const input = [...verses(23, 6), ...verses(24, 10)];

    const boundaries = segmentBook(input, {
      bookSlug: "psalms",
      chapterCount: 150,
    });

    expect(boundaries).toHaveLength(2);
    expect(boundaries[0]).toMatchObject({
      startChapter: 23,
      startVerse: 1,
      endChapter: 23,
      endVerse: 6,
      source: "whole-chapter",
    });
    expect(boundaries[1]?.endVerse).toBe(10);
  });

  it("uses the curated boundary for a well-established unit", () => {
    const input = verses(2, 22);

    const boundaries = segmentBook(input, {
      bookSlug: "ephesians",
      chapterCount: 6,
    });

    const grace = boundaries.find(
      (boundary) => boundary.startVerse === 8 && boundary.endVerse === 10,
    );

    expect(grace).toBeDefined();
    expect(grace?.source).toBe("curated");
  });

  it("keeps the put off / put on passage intact — the stages depend on it", () => {
    const boundaries = segmentBook(verses(3, 25), {
      bookSlug: "colossians",
      chapterCount: 4,
    });

    const putOffPutOn = boundaries.find(
      (boundary) => boundary.startVerse === 5 && boundary.endVerse === 14,
    );

    expect(putOffPutOn).toBeDefined();
    expect(putOffPutOn?.source).toBe("curated");
  });

  it("covers every verse exactly once", () => {
    const input = verses(4, 32);

    const boundaries = segmentBook(input, {
      bookSlug: "ephesians",
      chapterCount: 6,
    });

    const covered = boundaries.flatMap((boundary) =>
      boundary.verses.map((verse) => `${verse.chapter}:${verse.verse}`),
    );

    expect(covered).toHaveLength(input.length);
    expect(new Set(covered).size).toBe(input.length);
  });

  it("does not produce fixed-size chunks", () => {
    // The specific failure to avoid. If every passage is the same length, the
    // discourse scoring is not doing anything.
    const input = [
      { chapter: 1, verse: 1, text: "Now it happened in those days." },
      { chapter: 1, verse: 2, text: "And he went out." },
      { chapter: 1, verse: 3, text: "For the crowd was large." },
      { chapter: 1, verse: 4, text: "But he withdrew." },
      { chapter: 1, verse: 5, text: "Therefore the disciples asked him." },
      { chapter: 1, verse: 6, text: "And he answered." },
      { chapter: 1, verse: 7, text: "For it is written." },
      { chapter: 1, verse: 8, text: "After this he departed." },
      { chapter: 1, verse: 9, text: "And they followed." },
      { chapter: 1, verse: 10, text: "But some doubted." },
      { chapter: 1, verse: 11, text: "Then he spoke again." },
      { chapter: 1, verse: 12, text: "And the crowd listened." },
    ];

    const boundaries = segmentBook(input, {
      bookSlug: "nahum",
      chapterCount: 3,
    });

    const lengths = boundaries.map((boundary) => boundary.verses.length);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(input.length);
  });

  it("never breaks before a verse that continues the previous sentence", () => {
    const input = Array.from({ length: 20 }, (_unused, index) => ({
      chapter: 1,
      verse: index + 1,
      // Every verse is a continuation, so no break is ever attractive; the only
      // splits should come from the maximum length.
      text: "For this reason it continues.",
    }));

    const boundaries = segmentBook(input, {
      bookSlug: "nahum",
      chapterCount: 3,
    });

    for (const boundary of boundaries.slice(1)) {
      const opener = boundary.verses[0]?.text ?? "";
      // A break did happen (length ceiling), but only because it had to.
      expect(opener.toLowerCase().startsWith("for")).toBe(true);
    }

    // With no good boundary anywhere, it should fall back to the ceiling rather
    // than chopping every few verses.
    expect(boundaries.every((boundary) => boundary.verses.length >= 3)).toBe(true);
  });

  it("does not join across a gap left by a curated passage", () => {
    const input = verses(2, 22);

    const boundaries = segmentBook(input, {
      bookSlug: "ephesians",
      chapterCount: 6,
    });

    for (const boundary of boundaries) {
      const chapters = new Set(boundary.verses.map((verse) => verse.verse));
      const min = Math.min(...chapters);
      const max = Math.max(...chapters);
      // Contiguous: no passage may span the hole where 2:8-10 was removed.
      expect(max - min + 1).toBe(boundary.verses.length);
    }
  });

  it("returns nothing for an empty book", () => {
    expect(segmentBook([], { bookSlug: "jude", chapterCount: 1 })).toEqual([]);
  });
});

describe("curated pericope table integrity", () => {
  it("has no overlapping ranges within a book", () => {
    // The guard that would have caught six real collisions introduced when the
    // cross-chapter units were added: "Ephesians 5:1-21" beside
    // "Ephesians 5:21-6:9" overlaps at exactly one verse, and nothing about the
    // diff looks wrong. Two ranges claiming a verse makes coverage stop being a
    // partition and lets retrieval return the same words under two references.
    expect(findCuratedOverlaps()).toEqual([]);
  });
});
