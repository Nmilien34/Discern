// USX parsing.
//
// USX is the XML serialisation of the same data USFM carries, and ebible.org
// publishes both. The structure that matters:
//
//   <book code="EPH" .../>
//   <chapter number="2" .../>
//   <verse number="8" sid="EPH 2:8"/>  ...text...  <verse eid="EPH 2:8"/>
//   <note caller="+">...</note>
//
// USX 3.0 uses MILESTONE verses — a self-closing start tag, the text as a
// sibling, and a separate end tag — rather than wrapping the text in an element.
// So verse text is "everything between this verse marker and the next boundary",
// exactly as in USFM, not "the contents of this node".
//
// Deliberately hand-rolled rather than adding an XML dependency: the document
// shape is narrow and fixed, and the whole job is a linear scan.

import type { ParsedBook, ParsedVerse } from "./parse-usfm";
import { tidyWhitespace } from "./parse-usfm";

/** Removes <note>...</note> subtrees. Their prose is not scripture. */
function stripNotes(source: string): string {
  return source.replace(/<note\b[^>]*>.*?<\/note>/gs, " ");
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match?.[1];
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/**
 * Drops every remaining tag and normalises the text between them.
 *
 * Same whitespace repair as USFM: a removed <char> element around the end of a
 * sentence would otherwise leave a space before the full stop.
 */
function textBetween(source: string): string {
  return tidyWhitespace(decodeEntities(source.replace(/<[^>]*>/g, " ")));
}

function parseVerseNumber(raw: string): number | null {
  const match = /^(\d+)/.exec(raw);
  return match?.[1] ? Number(match[1]) : null;
}

export function parseUsx(source: string): ParsedBook {
  const bookTag = /<book\b[^>]*>/.exec(source);
  const code = bookTag ? attribute(bookTag[0], "code") : undefined;

  if (!code) {
    throw new Error(
      'No <book code="..."/> element found. A USX file must identify its book.',
    );
  }

  const cleaned = stripNotes(source);
  const verses: ParsedVerse[] = [];

  const markers = [...cleaned.matchAll(/<(chapter|verse)\b[^>]*>/g)];

  let chapter = 0;

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    if (!marker) continue;

    const tag = marker[0];
    const kind = marker[1];
    const number = attribute(tag, "number");

    if (kind === "chapter") {
      // A chapter END milestone carries eid and no number; it is not a new
      // chapter and must not reset the counter.
      if (number) {
        const parsed = Number.parseInt(number, 10);
        if (Number.isFinite(parsed)) chapter = parsed;
      }
      continue;
    }

    // Likewise a verse end milestone: <verse eid="EPH 2:8"/>.
    if (!number) continue;

    const verseNumber = parseVerseNumber(number);
    if (verseNumber === null || chapter === 0) continue;

    const start = marker.index + tag.length;
    const end = markers[index + 1]?.index ?? cleaned.length;
    const text = textBetween(cleaned.slice(start, end));

    if (text) {
      verses.push({ chapter, verse: verseNumber, text });
    }
  }

  return { usfmId: code.toUpperCase(), verses };
}
