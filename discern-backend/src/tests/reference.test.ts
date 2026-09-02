import { describe, expect, it } from "vitest";

import { AppError } from "../lib/errors";
import { formatReference, parseReference } from "../lib/reference";

describe("parseReference", () => {
  it("parses a full book name with a verse range", () => {
    const parsed = parseReference("Ephesians 2:8-10");

    expect(parsed.book.slug).toBe("ephesians");
    expect(parsed.startChapter).toBe(2);
    expect(parsed.startVerse).toBe(8);
    expect(parsed.endChapter).toBe(2);
    expect(parsed.endVerse).toBe(10);
    expect(parsed.canonical).toBe("Ephesians 2:8-10");
  });

  it("parses an abbreviation to the same passage", () => {
    expect(parseReference("Eph 2:8-10").canonical).toBe("Ephesians 2:8-10");
    expect(parseReference("eph2:8-10").canonical).toBe("Ephesians 2:8-10");
    expect(parseReference("Eph. 2:8-10").canonical).toBe("Ephesians 2:8-10");
  });

  it("parses a single verse", () => {
    const parsed = parseReference("John 3:16");

    expect(parsed.book.slug).toBe("john");
    expect(parsed.startVerse).toBe(16);
    expect(parsed.endVerse).toBe(16);
    expect(parsed.canonical).toBe("John 3:16");
  });

  it("parses a cross-chapter range", () => {
    const parsed = parseReference("Matthew 9:35-10:4");

    expect(parsed.startChapter).toBe(9);
    expect(parsed.startVerse).toBe(35);
    expect(parsed.endChapter).toBe(10);
    expect(parsed.endVerse).toBe(4);
    expect(parsed.canonical).toBe("Matthew 9:35-10:4");
  });

  it("binds a leading numeral to the book, not the chapter", () => {
    const parsed = parseReference("1 John 4:18");

    expect(parsed.book.slug).toBe("1-john");
    expect(parsed.startChapter).toBe(4);
    expect(parsed.startVerse).toBe(18);
  });

  it("treats a lone number in a one-chapter book as a VERSE", () => {
    // "Jude 4" means verse 4. Reading it as chapter 4 would 404 on a reference
    // that is both common and correct.
    const parsed = parseReference("Jude 4");

    expect(parsed.book.slug).toBe("jude");
    expect(parsed.startChapter).toBe(1);
    expect(parsed.startVerse).toBe(4);
  });

  it("parses a whole chapter", () => {
    const parsed = parseReference("Psalm 23");

    expect(parsed.book.slug).toBe("psalms");
    expect(parsed.startChapter).toBe(23);
    expect(parsed.isWholeChapter).toBe(true);
    expect(parsed.startVerse).toBeUndefined();
  });

  it("accepts an en dash, which is what pasted references carry", () => {
    expect(parseReference("Ephesians 2:8–10").canonical).toBe("Ephesians 2:8-10");
  });

  it("decodes a percent-encoded path segment", () => {
    expect(parseReference("Ephesians%202%3A8-10").canonical).toBe(
      "Ephesians 2:8-10",
    );
  });

  describe("rejects garbage as a 400, never a 500", () => {
    const badInputs: [string, string][] = [
      ["", "empty"],
      ["Hezekiah 3:1", "not a book"],
      ["asdfgh", "nonsense"],
      ["Ephesians", "book with no chapter"],
      ["Ephesians 99:1", "chapter beyond the book"],
      ["Ephesians 2:10-8", "range ends before it begins"],
      ["Matthew 10:5-9:1", "range ends in an earlier chapter"],
    ];

    for (const [input, label] of badInputs) {
      it(`${label}: "${input}"`, () => {
        let thrown: unknown;
        try {
          parseReference(input);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(AppError);
        expect((thrown as AppError).statusCode).toBe(400);
        expect((thrown as AppError).code).toBe("validation_error");
      });
    }
  });

  it("names the book when only the chapter is missing", () => {
    try {
      parseReference("Ephesians");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as AppError).message).toContain("Ephesians 1");
    }
  });
});

describe("formatReference", () => {
  it("round-trips every shape it produces", () => {
    const cases = [
      "Ephesians 2:8-10",
      "John 3:16",
      "Matthew 9:35-10:4",
      "Psalms 23",
    ];

    for (const reference of cases) {
      expect(parseReference(reference).canonical).toBe(reference);
    }
  });

  it("collapses a one-verse range to a single verse", () => {
    expect(
      formatReference({
        bookName: "John",
        startChapter: 3,
        startVerse: 16,
        endChapter: 3,
        endVerse: 16,
      }),
    ).toBe("John 3:16");
  });
});
