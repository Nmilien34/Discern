// Unmatched quotation marks at the edge of a sliced passage.
//
// The corpus stores whole verses, so a citation that starts or ends INSIDE a
// speech inherits one half of a quotation pair. Luke 14:10-11 is the case that
// surfaced it: WEB verse 11 ends `...will be exalted.”` and the opening “ is in
// verse 8, which is not cited — so the block closes a quote it never opened.
//
// THIS IS NOT A CULTIVATION-READ NICETY. Measured 2026-09-06 across the whole
// corpus: 1,242 of 4,090 stored pericopes — 30.4% — have unbalanced double
// quotation marks in WEB, because the SEGMENTATION ITSELF cuts through speeches.
// So this applies wherever a stored passage is shown as a block: carryings,
// Today's Carrying, search results, retrieval, and the set-apart block on a
// read. Roughly one passage in three needs it.
//
// TWO RULES:
//
//   1. Only DOUBLE marks are touched. WEB uses ‘ ’ for speech inside speech,
//      and Luke 14:10 and 2 Kings 5:11 both have one. Those are nested, they
//      balance, and they stay. Contractions use the same glyph as a closing
//      single mark, which is a second reason never to go near them.
//   2. CLOSERS ARE REMOVED. OPENERS ARE NOT, and the split is the point —
//      measured 2026-09-06 across the WEB corpus:
//
//        balanced                                       2,848
//        an unmatched ” only        (the CLOSER group)    291
//        an unmatched “             (the OPENER group)    951
//
//      A stray CLOSING mark is debris. Its speech began before this passage,
//      the reader never saw it open, and deleting the mark costs nothing —
//      Luke 14:10-11 ending "...will be exalted.”" reads better without it.
//
//      A stray OPENING mark is not debris, and deleting it CHANGES THE TEXT.
//      Every one of the ten sampled has the same shape: `God said, “What have
//      you done?` — the attribution is right there in the passage, and removing
//      the mark silently turns direct speech into narration. The reader is not
//      confused by a speech that runs past the end of a pericope; they are
//      confused by an app that quietly un-quotes scripture.
//
//      So openers are LEFT ALONE pending a decision. `openers: "remove"` exists
//      for when one is made. If the answer turns out to be "terminate the
//      quotation at the block edge", that is an ADDITION rather than a deletion
//      and should be built as its own thing, not smuggled in here.
//
// AND IT IS NOT FOR THE BIBLE READER. Whole chapters balance correctly, so
// running this over them could only ever make them worse.

export interface BalanceOptions {
  /**
   * DEFAULT "keep", AND IT MUST STAY THAT WAY. Read this before turning it on.
   *
   * `"remove"` exists so the rule can be stated as an option rather than as an
   * absence, and so the behaviour is testable. It is NOT a setting anybody
   * should enable. Deleting an unmatched opening mark turns
   *
   *     God said to Noah, “I will bring an end to all flesh
   *
   * into
   *
   *     God said to Noah, I will bring an end to all flesh
   *
   * — the app silently converting direct speech into narration, across 951 of
   * 4,090 WEB pericopes. Adding a closing mark instead is worse: it invents
   * punctuation asserting the speech ended where our segmenter happened to cut,
   * and it did not.
   *
   * The shipped answer mutates no text at all. `passageResponseSchema.continuesIn`
   * carries the pericope the speech runs on into, and the block keeps its mark
   * and gains an affordance underneath. A typography problem becomes navigation.
   *
   * If you are here because an unmatched mark looks wrong in a design review:
   * it IS wrong, and it is true. That is the trade this file already made.
   */
  openers?: "keep" | "remove";
}

/** Removes a double mark whose partner is not in this text. Closers only. */
export function balanceBlockQuotes(
  text: string,
  options: BalanceOptions = {},
): string {
  const OPEN = "\u201C";
  const CLOSE = "\u201D";
  const removeOpeners = options.openers === "remove";

  const unmatched = new Set<number>();
  const openStack: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === OPEN) openStack.push(i);
    else if (text[i] === CLOSE) {
      if (openStack.length > 0) openStack.pop();
      else unmatched.add(i);
    }
  }
  // Anything still open at the end had its closer cut off. Left in place unless
  // asked for, because deleting it turns speech into narration.
  if (removeOpeners) for (const index of openStack) unmatched.add(index);

  if (unmatched.size === 0) return text;

  return [...text]
    .filter((_char, index) => !unmatched.has(index))
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Does this text open a quotation it never closes?
 *
 * The one question that decides whether a passage block gets a continuation
 * affordance. Only DOUBLE marks count, for the same reason they are the only
 * ones `balanceBlockQuotes` touches: WEB nests speech in single marks and uses
 * the same glyph for apostrophes.
 */
export function hasUnclosedQuotation(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === "“") depth += 1;
    else if (char === "”" && depth > 0) depth -= 1;
  }
  return depth > 0;
}
