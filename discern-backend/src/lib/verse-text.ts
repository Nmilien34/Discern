// Verse text normalisation.
//
// ONE JOB SO FAR: the KJV pilcrow.
//
// 2,970 KJV verses in the corpus begin with "¶ " — 9.5% of the translation,
// and zero verses in WEB. It is a PARAGRAPH MARK, not a word: the KJV's
// typesetting uses it to open a new paragraph, and the plain-text edition the
// corpus was ingested from carries it inline.
//
// SO IT IS CONVERTED, NOT STRIPPED. Stripping would throw away real structure
// permanently — where the paragraphs begin is information the reader screen
// wants — while leaving it in ships a stray glyph into every passage block,
// every carrying, and anything ever synthesized, where a narrator would either
// read it or, worse, have it silently baked into an audio cache key.
//
// Measured before writing this: all 2,970 are LEADING, none mid-verse, none
// doubled. So the conversion is unambiguous and total.

/** A leading paragraph mark, with any space that follows it. */
const LEADING_PARAGRAPH_MARK = /^\s*¶\s*/;

export interface VerseText {
  text: string;
  /** True when this verse opens a paragraph in the source typesetting. */
  paragraphStart: boolean;
}

/**
 * Splits a paragraph mark off a verse, if it has one.
 *
 * Idempotent: text that has already been converted comes back unchanged with
 * `paragraphStart: false`, so re-running ingestion or the migration is safe.
 * That matters because the migration is an upsert over a live corpus.
 */
export function splitParagraphMark(raw: string): VerseText {
  if (!LEADING_PARAGRAPH_MARK.test(raw)) {
    return { text: raw, paragraphStart: false };
  }
  return { text: raw.replace(LEADING_PARAGRAPH_MARK, ""), paragraphStart: true };
}

/** Whether a stored verse still needs converting. */
export function hasParagraphMark(raw: string): boolean {
  return raw.includes("¶");
}
