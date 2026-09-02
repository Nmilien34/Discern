import { describe, expect, it } from "vitest";

import { parseUsfm } from "../services/corpus/parse-usfm";
import { parseUsx } from "../services/corpus/parse-usx";

describe("parseUsfm", () => {
  it("reads the book id, chapters and verses", () => {
    const source = [
      "\\id PHM - Test",
      "\\c 1",
      "\\p",
      "\\v 1 First verse text.",
      "\\v 2 Second verse text.",
      "\\c 2",
      "\\v 1 Third verse text.",
    ].join("\n");

    const parsed = parseUsfm(source);

    expect(parsed.usfmId).toBe("PHM");
    expect(parsed.verses).toEqual([
      { chapter: 1, verse: 1, text: "First verse text." },
      { chapter: 1, verse: 2, text: "Second verse text." },
      { chapter: 2, verse: 1, text: "Third verse text." },
    ]);
  });

  it("joins verse text that continues across lines", () => {
    // Poetry markers put each line on its own row. Stopping at the newline would
    // truncate most of the Psalms.
    const source = [
      "\\id PSA",
      "\\c 1",
      "\\q1",
      "\\v 1 The first line",
      "\\q2 and the second line",
      "\\q1 and the third.",
      "\\v 2 Next verse.",
    ].join("\n");

    const parsed = parseUsfm(source);

    expect(parsed.verses[0]?.text).toBe(
      "The first line and the second line and the third.",
    );
  });

  it("removes footnotes and cross references entirely", () => {
    // Footnote prose reads like scripture but is not. Left in, it ends up in an
    // embedding and Abigail hands somebody a footnote.
    const source = [
      "\\id GEN",
      "\\c 1",
      "\\v 1 In the beginning\\f + \\fr 1.1 \\ft Or, when God began.\\f* God created.",
      "\\v 2 Second\\x - \\xo 1.2 \\xt John 1:1\\x* verse.",
    ].join("\n");

    const parsed = parseUsfm(source);

    expect(parsed.verses[0]?.text).toBe("In the beginning God created.");
    expect(parsed.verses[0]?.text).not.toContain("Or, when God began");
    expect(parsed.verses[1]?.text).toBe("Second verse.");
  });

  it("keeps the words inside inline markup", () => {
    const source = [
      "\\id EXO",
      "\\c 3",
      "\\v 14 \\nd Yahweh\\nd* said, \\wj I am\\wj*.",
    ].join("\n");

    expect(parseUsfm(source).verses[0]?.text).toBe("Yahweh said, I am.");
  });

  it("keeps the word and drops the lexical attributes of \\w", () => {
    const source = [
      "\\id GEN",
      "\\c 1",
      '\\v 1 \\w In|strong="H1234"\\w* the \\w beginning\\w*.',
    ].join("\n");

    expect(parseUsfm(source).verses[0]?.text).toBe("In the beginning.");
  });

  it("anchors a merged verse to its first number", () => {
    const source = ["\\id RUT", "\\c 1", "\\v 1-2 Merged verse text."].join("\n");

    expect(parseUsfm(source).verses).toEqual([
      { chapter: 1, verse: 1, text: "Merged verse text." },
    ]);
  });

  it("throws a readable error when there is no \\id", () => {
    expect(() => parseUsfm("\\c 1\n\\v 1 Orphan.")).toThrow(/\\id/);
  });
});

describe("parseUsx", () => {
  it("reads milestone verses, where text is a sibling not a child", () => {
    const source = `<usx version="3.0">
      <book code="EPH" style="id">Ephesians</book>
      <chapter number="2" style="c" sid="EPH 2"/>
      <para style="p">
        <verse number="8" style="v" sid="EPH 2:8"/>For by grace.<verse eid="EPH 2:8"/>
        <verse number="9" style="v" sid="EPH 2:9"/>Not of works.<verse eid="EPH 2:9"/>
      </para>
      <chapter eid="EPH 2"/>
    </usx>`;

    const parsed = parseUsx(source);

    expect(parsed.usfmId).toBe("EPH");
    expect(parsed.verses).toEqual([
      { chapter: 2, verse: 8, text: "For by grace." },
      { chapter: 2, verse: 9, text: "Not of works." },
    ]);
  });

  it("removes note subtrees", () => {
    const source = `<usx><book code="GEN"/><chapter number="1"/>
      <para style="p"><verse number="1" sid="GEN 1:1"/>In the beginning<note caller="+" style="f"><char style="ft">Or, when God began.</char></note> God created.</para>
    </usx>`;

    const parsed = parseUsx(source);

    expect(parsed.verses[0]?.text).toBe("In the beginning God created.");
    expect(parsed.verses[0]?.text).not.toContain("Or, when God began");
  });

  it("decodes XML entities", () => {
    const source = `<usx><book code="JHN"/><chapter number="1"/>
      <para><verse number="1" sid="JHN 1:1"/>Light &amp; life &#8212; both.</para></usx>`;

    expect(parseUsx(source).verses[0]?.text).toBe("Light & life — both.");
  });

  it("does not treat an end milestone as a new chapter", () => {
    const source = `<usx><book code="PHM"/><chapter number="1"/>
      <para><verse number="1" sid="PHM 1:1"/>Text.</para><chapter eid="PHM 1"/></usx>`;

    expect(parseUsx(source).verses).toEqual([
      { chapter: 1, verse: 1, text: "Text." },
    ]);
  });

  it("throws a readable error when there is no book element", () => {
    expect(() => parseUsx("<usx><chapter number='1'/></usx>")).toThrow(/book/);
  });
});
