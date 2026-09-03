// THE PREMISE PASS.
//
// ARCHITECTURE.md §7 calls this "the entire difference between Abigail and a
// generic Bible chatbot", and the brief is explicit that it must be ITS OWN
// MODEL CALL rather than a line in a system prompt.
//
// The reason is not architectural tidiness. A model asked to do six things in
// one prompt does the easy five and gestures at the hardest — and "notice the
// assumption underneath what this person said, and say whether it is wrong" is
// by far the hardest, because it requires disagreeing with someone who is upset.
// Given as a clause among others it becomes a sentence of acknowledgement. Given
// alone, with nothing else to produce, it gets answered.
//
// The output feeds the reasoning turn as INPUT. It is never shown to the user.

import OpenAI from "openai";

import { effort, models } from "../../config/models";
import { prompts } from "../../config/prompts";
import { logger } from "../../lib/logger";
import { openaiFor } from "../../lib/openai-client";

export interface PremiseResult {
  /** The assumption underneath, stated plainly. */
  premise: string;
  /** Whether it holds up. */
  verdict: "sound" | "incomplete" | "wrong" | "unclear";
  /** What is actually true, when the premise does not hold. */
  correction: string | null;
  /** What the person is asking underneath the question they asked. */
  realQuestion: string;
  /**
   * A TURN-SPECIFIC INSTRUCTION for Abigail, written for this conversation.
   *
   * The premise pass already sees things the system prompt can only describe in
   * general — that this person has placed the whole problem on someone else,
   * that they are asking for a promise nobody can make. Until now that only
   * picked a model and filled in context.
   *
   * A standing prompt line competes with thirty other standing prompt lines and
   * loses about one time in five. An instruction written for THIS turn, naming
   * THIS person's shape, does not. Null when the turn needs no special handling,
   * which is most of them — a directive on every turn is a directive on none.
   */
  directive: string | null;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/**
 * The premise classifier's prompt.
 *
 * The TEXT lives in prompts/premise-system.txt, outside the repository — see
 * config/prompts.ts. It carries four phases of measurement about when NOT to
 * flag something, which is the part that took the work.
 */
const SYSTEM_PROMPT: string = prompts.premiseSystem;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["premise", "verdict", "correction", "realQuestion", "directive"],
  properties: {
    premise: { type: "string" },
    verdict: { type: "string", enum: ["sound", "incomplete", "wrong", "unclear"] },
    correction: { type: ["string", "null"] },
    realQuestion: { type: "string" },
    directive: { type: ["string", "null"] },
  },
} as const;

let client: OpenAI | null = null;
const getClient = (): OpenAI =>
  (client ??= openaiFor("premise"));

export async function runPremisePass(
  userMessage: string,
  context: { recentTurns?: string[] } = {},
): Promise<PremiseResult> {
  const startedAt = Date.now();

  const recent = context.recentTurns?.length
    ? `\n\nEarlier in this conversation:\n${context.recentTurns.slice(-4).join("\n")}`
    : "";

  try {
    const response = await getClient().chat.completions.create({
      // MID tier (ARCHITECTURE.md §7). Naming a wrong assumption is a judgement,
      // not a classification, and the cheapest model is not good enough at it.
      model: models.premise,
      reasoning_effort: effort.premise,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `They said: "${userMessage}"${recent}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "premise", strict: true, schema: RESPONSE_SCHEMA },
      },
      max_completion_tokens: 4_000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("premise pass returned empty content");

    const parsed = JSON.parse(content) as Omit<
      PremiseResult,
      "modelUsed" | "tokensIn" | "tokensOut" | "latencyMs"
    >;

    return {
      ...parsed,
      modelUsed: models.premise,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Degrade rather than fail the turn. Abigail without a premise pass is a
    // worse Abigail; Abigail returning an error is no Abigail at all.
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "premise pass failed; continuing without it",
    );

    return {
      premise: "",
      verdict: "unclear",
      correction: null,
      realQuestion: userMessage,
      directive: null,
      modelUsed: models.premise,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
    };
  }
}
