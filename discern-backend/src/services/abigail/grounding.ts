// THE GROUNDING CHECK. ENFORCED IN CODE, NOT PROMPT.
//
// ARCHITECTURE.md design rule 1: "Abigail must cite a retrieved passage for any
// substantive claim. Enforced in code."
//
// The distinction matters because a prompt is a request and this is a
// guarantee. A model told to always cite will usually cite; "usually" is not a
// property you can build a product on when the failure mode is inventing a Bible
// verse and attributing it to God.
//
// What this checks is narrow and deliberately so:
//
//   1. A substantive reply must have called at least one retrieval tool.
//   2. A substantive reply must actually CITE one. "Always lands on scripture"
//      only means something if absence fails — the first version checked only
//      that citations were real, so a reply saying "when you come back I can
//      bring you a passage" passed while landing on nothing at all.
//   3. Every reference she QUOTES must be one a tool actually returned. This is
//      the anti-hallucination check — a plausible-looking "Philippians 4:19"
//      that no tool retrieved is exactly the failure to catch.
//
// It does NOT judge theology, tone, or whether the passage was well chosen. Code
// cannot do those, and pretending otherwise would give false confidence.

import { logger } from "../../lib/logger";
import { parseReference } from "../../lib/reference";

export interface GroundingInput {
  reply: string;
  /** References returned by tools this turn. */
  retrievedReferences: string[];
  toolCallCount: number;
}

export interface GroundingVerdict {
  grounded: boolean;
  reason: string | null;
  /** References she cited that no tool returned. The dangerous case. */
  uncitedReferences: string[];
}

/**
 * Matches a scripture reference in prose.
 *
 * Book names can carry a leading numeral and internal spaces ("1 Corinthians",
 * "Song of Solomon"), so the pattern allows a numeral, then capitalised words,
 * then chapter:verse.
 */
const REFERENCE_PATTERN =
  /\b((?:[123]\s+)?(?:[A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+)?))\s+(\d+):(\d+)(?:\s*[-–]\s*(?:\d+:)?\d+)?/g;

/**
 * The distinct passages a reply actually REFERENCES, as "Book Chapter".
 *
 * `TurnResult.citations` is not this. That field accumulates every passage the
 * TOOLS returned — a single `search_scripture` call contributes five — so it
 * measures how widely she searched, not what she wrote. Counting it as output
 * overstates a one-passage reply by a factor of five.
 *
 * Verses collapse to their chapter, because "Psalm 46:1" and "Psalm 46:10" are
 * one passage quoted twice, not two passages. Book names are lowercased and
 * lose a trailing "s" so "Psalm" and "Psalms" agree; that also turns "Romans"
 * into "roman", which is harmless because it does so consistently.
 */
export function referencedPassages(reply: string): string[] {
  const seen = new Set<string>();

  for (const match of reply.matchAll(REFERENCE_PATTERN)) {
    const book = match[1]?.trim();
    const chapter = match[2];
    if (book && chapter) {
      seen.add(`${book.toLowerCase().replace(/s$/, "")} ${chapter}`);
    }
  }

  return [...seen];
}

/** Short, common replies that make no claim and therefore need no citation. */
function isSubstantive(reply: string): boolean {
  const words = reply.trim().split(/\s+/).length;
  return words > 25;
}

/**
 * Is `citation` inside `source`?
 *
 * PARSED, NOT STRING-MATCHED. The first version compared normalised strings with
 * startsWith, and it rejected correct citations in two ways at once: "Psalm
 * 42:5" does not prefix-match the stored "Psalms 42:1-11" (singular vs plural),
 * and prefix matching has no concept of a verse lying INSIDE a range. Fourteen
 * of twenty eval turns fell back to the safe response because of it — the model
 * was citing properly and being told it was not.
 *
 * parseReference already resolves book aliases and ranges and is tested, so the
 * containment question is answered with numbers rather than with substrings.
 */
function citationIsCovered(citation: string, sources: string[]): boolean {
  let cited: ReturnType<typeof parseReference>;
  try {
    cited = parseReference(citation);
  } catch {
    // Unparseable: not a real reference, so not an uncited claim either.
    return true;
  }

  const citedStart = cited.startVerse ?? 1;

  for (const source of sources) {
    let span: ReturnType<typeof parseReference>;
    try {
      span = parseReference(source);
    } catch {
      continue;
    }

    if (span.book.slug !== cited.book.slug) continue;

    const spanStartChapter = span.startChapter;
    const spanEndChapter = span.endChapter;
    const spanStartVerse = span.startVerse ?? 1;
    const spanEndVerse = span.endVerse ?? Number.MAX_SAFE_INTEGER;

    const afterStart =
      cited.startChapter > spanStartChapter ||
      (cited.startChapter === spanStartChapter && citedStart >= spanStartVerse);
    const beforeEnd =
      cited.startChapter < spanEndChapter ||
      (cited.startChapter === spanEndChapter && citedStart <= spanEndVerse);

    if (afterStart && beforeEnd) return true;
  }

  return false;
}

export function checkGrounding(input: GroundingInput): GroundingVerdict {
  const { reply, retrievedReferences, toolCallCount } = input;

  if (!isSubstantive(reply)) {
    return { grounded: true, reason: null, uncitedReferences: [] };
  }

  if (toolCallCount === 0) {
    return {
      grounded: false,
      reason:
        "A substantive reply was produced without calling any tool. Every claim has to rest on a passage that was actually retrieved.",
      uncitedReferences: [],
    };
  }

  const cited = new Set<string>();

  for (const match of reply.matchAll(REFERENCE_PATTERN)) {
    const book = match[1]?.trim();
    const chapter = match[2];
    const verse = match[3];
    if (book && chapter && verse) cited.add(`${book} ${chapter}:${verse}`);
  }

  // Quoting ONE VERSE of a passage you were handed is correct behaviour, not a
  // fault, so containment is what is checked — not string equality.
  // ARCHITECTURE.md design rule 1: she must cite a retrieved passage for any
  // substantive claim. A reply that deferred scripture to "next time" has not
  // done that, however well it read.
  if (cited.size === 0) {
    return {
      grounded: false,
      reason:
        "A substantive reply cited no passage at all. She must land on scripture, not defer it — quote and name one of the passages the tools returned.",
      uncitedReferences: [],
    };
  }

  const uncited = [...cited].filter(
    (citation) => !citationIsCovered(citation, retrievedReferences),
  );

  if (uncited.length > 0) {
    return {
      grounded: false,
      reason: `Cited ${uncited.join(", ")}, which no tool returned this turn. References must come from retrieval, never from memory.`,
      uncitedReferences: uncited,
    };
  }

  return { grounded: true, reason: null, uncitedReferences: [] };
}

/**
 * The last resort, after one regeneration has already failed.
 *
 * Says less rather than risking saying something false. It does not pretend the
 * turn went well, and it does not invent a passage to fill the gap.
 */
export const GROUNDING_FALLBACK =
  "I want to point you at something specific here rather than give you my own opinion, and I'm not able to reach the text properly right now. Rather than say something I can't stand behind, I'd rather wait.\n\nCome back and tell me again in a moment — and if this is something heavy, please say it to someone who knows you, not only to an app.";

export function logGroundingFailure(
  verdict: GroundingVerdict,
  attempt: number,
): void {
  logger.warn(
    {
      attempt,
      reason: verdict.reason,
      uncited: verdict.uncitedReferences,
    },
    "grounding check failed",
  );
}
