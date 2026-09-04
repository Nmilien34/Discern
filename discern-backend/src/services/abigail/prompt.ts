// Abigail's system prompt.
//
// ARCHITECTURE.md §7 "Prompt discipline". Every line below is one of those
// rules, written so it can actually be followed rather than merely agreed with.
//
// THE PROMPT TEXT IS NOT IN THIS FILE, OR IN THIS REPOSITORY. It is loaded from
// prompts/abigail-system.txt at boot (config/prompts.ts). The repository is
// public and that text is the product.
//
// The prompt is NOT where the hard guarantees live. Grounding is enforced in
// code (grounding.ts), the safety gate runs before this ever executes, and the
// harm filter strips passages before she sees them. A prompt is an instruction;
// those three are facts.

import { prompts } from "../../config/prompts";

import type { PremiseResult } from "./premise";

export interface PromptContext {
  premise: PremiseResult;
  currentStage: { slug: string; from: string; to: string } | null;
  carryings: { reference: string; why: string | null; revisitCount: number }[];
  facts: string[];
  people: { name: string; relationship: string; context: string }[];
  passagesGiven: { ref: string; why: string }[];
  openThreads: string[];
  /**
   * Passages already retrieved for this turn, before she was asked anything.
   *
   * Seeded from the premise pass's `realQuestion`, formatted exactly as a
   * search_scripture result — full text, cautions, author circumstances, the
   * same harm gates. She used to spend one round deciding to search and another
   * reading what came back; this puts a starting point in front of her instead.
   */
  preSearched: string | null;
}

/**
 * Abigail's system prompt.
 *
 * The TEXT lives in prompts/abigail-system.txt, outside the repository — see
 * config/prompts.ts for why. Everything about how it is used is still here.
 */
export const ABIGAIL_SYSTEM_PROMPT: string = prompts.abigailSystem;

/**
 * Added to her instructions ONLY when this turn will be spoken.
 *
 * Rhythm, not substance. A sentence that reads well can be hard to follow by
 * ear — a listener cannot go back a line — so the shape changes and nothing
 * else does. Every rule about correcting a premise, refusing to comfort, and
 * landing on scripture is untouched, and this must not be read as licence to
 * soften any of them.
 */
export const SPEAKING_STYLE = `THIS REPLY WILL BE READ ALOUD.

Write it for the ear. Shorter sentences than you would type. Contractions —
"isn't", "won't", "you're" — because nobody speaks in full forms. No
parenthetical asides and no subordinate clauses stacked three deep: a listener
cannot go back a line the way a reader can.

Say the reference the way a person says it, in the flow of the sentence, not as
a label bolted on.

NOTHING ELSE CHANGES. Not the premise correction, not the refusal to promise
outcomes, not the requirement to land on a retrieved passage. If a hard thing
needs saying, say it — a gentler rhythm is not a gentler message.`;

export function buildContextMessage(context: PromptContext): string {
  const parts: string[] = [];

  // THE DIRECTIVE GOES FIRST, ABOVE EVERYTHING.
  //
  // It is written for THIS turn by the pass that just read what they said, and
  // it exists because a standing prompt line loses. "Ask about their own part"
  // sits in the system prompt competing with thirty other rules and was obeyed
  // four times in five; the fifth reply cited Matthew 18's process and never
  // asked the man what he had done. An instruction written for this person,
  // placed where nothing else is, does not get averaged away.
  //
  // Null on most turns, which is what keeps it load-bearing on the few.
  if (context.premise.directive) {
    parts.push(
      "=== DO THIS FIRST, BEFORE ANYTHING ELSE ===",
      context.premise.directive,
      "This was written for this specific turn after reading what they said. It",
      "takes priority over the general guidance in your instructions.",
      "",
    );
  }

  parts.push("=== PREMISE ANALYSIS (not visible to them) ===");
  if (context.premise.premise) {
    parts.push(`They are assuming: ${context.premise.premise}`);
    parts.push(`That assumption is: ${context.premise.verdict.toUpperCase()}`);
    if (context.premise.correction) {
      parts.push(`What is actually true: ${context.premise.correction}`);
    }
    parts.push(`What they are really asking: ${context.premise.realQuestion}`);

    if (context.premise.verdict === "wrong") {
      parts.push(
        "ACT ON THIS. Correct it early and plainly. Do not affirm the assumption first to soften it.",
      );
    } else if (context.premise.verdict === "incomplete") {
      parts.push("ACT ON THIS. What they believe is true but missing something.");
    } else if (context.premise.verdict === "sound") {
      parts.push(
        "Their premise holds. Do not invent a correction — meet them where they are and take them to scripture.",
      );
    }
  } else {
    parts.push("(unavailable this turn)");
  }

  if (context.currentStage) {
    parts.push(
      `\n=== STAGE ===\nThey are working through ${context.currentStage.from} → ${context.currentStage.to}.`,
    );
  }

  if (context.carryings.length > 0) {
    parts.push("\n=== WHAT THEY ARE ALREADY CARRYING ===");
    for (const c of context.carryings) {
      parts.push(
        `${c.reference}${c.why ? ` — you gave them this because: ${c.why}` : ""} (returned to ${c.revisitCount}×)`,
      );
    }
    if (context.carryings.length >= 3) {
      parts.push(
        "They are at the limit of three. You cannot give them a fourth without one being released.",
      );
    }
  }

  if (context.passagesGiven.length > 0) {
    parts.push(
      "\n=== ALREADY GIVEN — DO NOT HAND THESE OVER AGAIN ===\n" +
        context.passagesGiven.map((p) => p.ref).join(", "),
    );
  }

  if (context.facts.length > 0) {
    parts.push("\n=== WHAT THEY HAVE TOLD YOU ===\n" + context.facts.join("\n"));
  }

  if (context.people.length > 0) {
    parts.push(
      "\n=== PEOPLE THEY HAVE MENTIONED ===\n" +
        context.people
          .map((p) => `${p.name} (${p.relationship}) — ${p.context}`)
          .join("\n"),
    );
  }

  if (context.preSearched) {
    parts.push(
      "\n=== PASSAGES ALREADY RETRIEVED FOR YOU ===\n" +
        "These came from a search on what they are actually asking, run before\n" +
        "you were called. They are a STARTING POINT, not a shortlist you must\n" +
        "choose from — if none of them fits, search again with better words.\n" +
        "You may quote and cite these directly; they were retrieved with a tool\n" +
        "exactly as if you had called it yourself.\n\n" +
        context.preSearched,
    );
  }

  if (context.openThreads.length > 0) {
    parts.push(
      "\n=== OPEN THREADS FROM LAST TIME ===\n" + context.openThreads.join("\n"),
    );
  }

  return parts.join("\n");
}
