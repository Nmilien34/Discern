// SENTENCE BOUNDARIES, FOR SYNTHESIZING WHILE SHE IS STILL WRITING.
//
// Waiting for the whole reply before speaking adds a second wait on top of a
// forty-nine second one. Synthesizing per sentence means audio starts while she
// is still on the second paragraph.
//
// The hard part is not splitting sentences — it is not splitting them WRONG,
// because a false boundary sends half a clause to a per-character API and it
// comes back as a fragment read with the wrong intonation. So the rules are
// conservative: abbreviations, initials and scripture references are the things
// that actually appear in her replies, and each is protected.

/** Never a sentence end, however much they look like one. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "rev", "fr", "e.g", "i.e", "cf", "vs", "etc",
  // Book abbreviations she writes inside citations.
  "gen", "ex", "lev", "num", "deut", "josh", "judg", "sam", "kgs", "chr",
  "neh", "ps", "psa", "prov", "eccl", "isa", "jer", "lam", "ezek", "dan",
  "hos", "obad", "mic", "nah", "hab", "zeph", "hag", "zech", "mal",
  "matt", "mk", "lk", "jn", "rom", "cor", "gal", "eph", "phil", "col",
  "thess", "tim", "tit", "philem", "heb", "jas", "pet", "rev",
]);

/** Shortest thing worth sending on its own. "Yes." is not worth a request. */
const MIN_SENTENCE_CHARS = 24;

/** Characters held back from the decision so trailing quotes can arrive. */
const LOOKAHEAD = 3;

function endsSentence(buffer: string, index: number): boolean {
  const ch = buffer[index];
  if (ch !== "." && ch !== "!" && ch !== "?") return false;

  // "3:16" and "v. 4" — a digit either side of a period is a reference.
  const before = buffer[index - 1] ?? "";
  const after = buffer[index + 1] ?? "";
  if (ch === "." && /\d/.test(before) && /\d/.test(after)) return false;

  // The next character must be whitespace, a closing quote, or the end.
  if (after && !/[\s")'”’]/.test(after)) return false;

  const word = (buffer.slice(0, index).match(/([A-Za-z.]+)$/)?.[1] ?? "")
    .toLowerCase()
    .replace(/^\.+/, "");

  if (ABBREVIATIONS.has(word)) return false;
  // A single initial: "C. S. Lewis".
  if (/^[a-z]$/.test(word)) return false;

  return true;
}

/**
 * Accumulates streamed text and hands back complete sentences.
 *
 * `push` returns whatever became speakable with that delta — usually nothing,
 * occasionally one sentence, rarely two. `flush` returns the tail at the end,
 * which is the last sentence when the model stopped without punctuation.
 */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];

    // LOOKAHEAD MARGIN. Deltas arrive a character at a time, so the last few
    // characters of the buffer are not yet decidable: at the moment the "." of
    // `okay."` lands there is no closing quote yet, and deciding then splits
    // the sentence and orphans the quote onto the next one. Leaving a margin
    // costs one delta of latency and gets the boundary right.
    const decidable = this.buffer.length - LOOKAHEAD;

    let start = 0;
    for (let i = 0; i < decidable; i += 1) {
      if (!endsSentence(this.buffer, i)) continue;

      // Take any closing quote with the sentence rather than orphaning it.
      let end = i + 1;
      while (end < this.buffer.length && /["')”’]/.test(this.buffer[end] ?? "")) {
        end += 1;
      }

      const candidate = this.buffer.slice(start, end).trim();

      // Too short to be worth a request on its own — let it join the next one.
      if (candidate.length < MIN_SENTENCE_CHARS) continue;

      out.push(candidate);
      start = end;
    }

    if (start > 0) this.buffer = this.buffer.slice(start);
    return out;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}

/**
 * Strip what should not be read aloud.
 *
 * Her replies carry markdown bullets and parenthetical references. "(Psalm
 * 27:1, 13-14)" read literally is "open paren Psalm twenty seven colon one" —
 * the reference belongs on screen, not in the ear.
 */
export function speakable(text: string): string {
  return text
    .replace(/^[\s]*[-*•]\s+/gm, "")
    .replace(/\((?:see\s+)?[1-3]?\s*[A-Z][a-z]+\.?\s+\d+[:\d\s,–-]*\)/g, "")
    .replace(/[*_`#]/g, "")
    // Removing a parenthetical reference leaves the punctuation that followed
    // it stranded: `Whom shall I fear?" .` — read aloud that is a pause and a
    // swallowed click.
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])\s*\1+/g, "$1")
    // `Whom shall I fear?" .` -> `Whom shall I fear?"`. The sentence already
    // ended inside the quote; the stranded period is punctuation for the eye.
    .replace(/([.!?]["')\u201d\u2019])\s*\./g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
