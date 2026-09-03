// Model routing. THE ONLY PLACE A MODEL ID APPEARS.
//
// ARCHITECTURE.md §7 routes each turn to the cheapest model that can do the job,
// because running the reasoning model on every turn is the largest avoidable
// cost in the app. CONVENTIONS.md §2 makes these config values rather than
// constants: any tier can be swapped from the Render dashboard with no code
// change and no deploy.
//
// Do not import a literal model ID anywhere else. Every call site takes its
// model from `models`, and every message persists `modelUsed` so spend is
// attributable per conversation (ARCHITECTURE.md §7).

import { env } from "./env";

export interface ModelTiers {
  /**
   * Runs on EVERY turn, before anything else, and gates the whole pipeline
   * (ARCHITECTURE.md §8). Optimise for latency and cost: it is pure
   * classification, it sees short input, and the user is waiting on it.
   */
  safety: string;

  /**
   * The premise pass — one question, asked separately from the main turn.
   * ARCHITECTURE.md §7 calls this the entire difference between Abigail and a
   * generic Bible chatbot, so it gets a mid tier rather than the cheapest one:
   * naming a wrong assumption is a judgement, not a classification.
   */
  premise: string;

  /** Acknowledgments and small follow-ups that surface no passage. */
  conversation: string;

  /**
   * Reserved for turns that surface a passage, name a stage, or correct a
   * premise. This is the expensive tier and the one that must not run by
   * default.
   */
  reasoning: string;

  /**
   * The HyDE query rewrite that runs before every vector search.
   *
   * Its own tier rather than borrowing `conversation`, because the two jobs are
   * nothing alike: one holds a conversation, the other turns a sentence into
   * passage-shaped text. Measured on Render at the conversation tier it took
   * 5.4-12.5s and emitted 429-795 OUTPUT tokens for a one-line rewrite — which
   * is a reasoning model thinking hard about a task that does not need it.
   */
  hyde: string;

  /**
   * Corpus and query embeddings.
   *
   * CHANGING THIS INVALIDATES THE INDEX. Every passage and hymn records the
   * `embeddingModel` it was written with (ARCHITECTURE.md §6) precisely so a
   * change here is detectable and the backfill can re-run. A query embedded
   * with a different model than the corpus does not error — it silently
   * retrieves badly, which on this product looks like Abigail giving people the
   * wrong scripture.
   */
  embedding: string;
}

/**
 * Defaults. Every one is overridable by the matching env var.
 *
 * Treat these as a starting point to measure, not a settled choice — the tier
 * boundaries are the durable design, the specific IDs are not. Verify each
 * against current OpenAI pricing and availability before Phase 6, since that is
 * the phase where the routing starts costing real money.
 */
export const models: ModelTiers = {
  safety: env.SAFETY_MODEL ?? "gpt-5-nano",
  premise: env.PREMISE_MODEL ?? "gpt-5-mini",
  conversation: env.CONVERSATION_MODEL ?? "gpt-5-mini",
  reasoning: env.REASONING_MODEL ?? "gpt-5",
  hyde: env.HYDE_MODEL ?? "gpt-5-mini",
  embedding: env.EMBEDDING_MODEL ?? "text-embedding-3-large",
};

/**
 * How hard each tier is allowed to think.
 *
 * THIS WAS UNSET EVERYWHERE UNTIL 2026-09-02, so every call ran at the API's
 * default. On the gpt-5 family that default is not cheap: individual reasoning
 * rounds measured 3-51 seconds on Render, and the query rewriter — a job whose
 * entire output is three sentences — was spending the better part of a thousand
 * output tokens getting there.
 *
 * Effort is the first thing to turn down and the first thing to turn back up,
 * which is why it is config rather than a literal at each call site. Every value
 * below is overridable by env, so a regression is a dashboard change and not a
 * deploy.
 *
 * `minimal` is not "no thinking" — it is "answer without an extended chain".
 * For classification and rewriting that is the whole job.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface EffortTiers {
  safety: ReasoningEffort;
  premise: ReasoningEffort;
  conversation: ReasoningEffort;
  reasoning: ReasoningEffort;
  hyde: ReasoningEffort;
}

export const effort: EffortTiers = {
  // Pure classification against a fixed enum. There is nothing to reason about.
  safety: (env.SAFETY_EFFORT as ReasoningEffort) ?? "minimal",
  // A judgement, but a narrow one, and its prompt does the heavy lifting.
  premise: (env.PREMISE_EFFORT as ReasoningEffort) ?? "low",
  // The tier that writes most replies.
  conversation: (env.CONVERSATION_EFFORT as ReasoningEffort) ?? "low",
  reasoning: (env.REASONING_EFFORT as ReasoningEffort) ?? "medium",
  // Turning a sentence into passage-shaped text. Nothing to deliberate over.
  hyde: (env.HYDE_EFFORT as ReasoningEffort) ?? "minimal",
};

export type ModelTier = keyof ModelTiers;

/**
 * Output dimensions of the embedding model, and the single source of truth for
 * the Atlas index's `numDimensions`.
 *
 * THESE MUST AGREE. Atlas does not validate a vector's length against the index
 * on write — a mismatch surfaces as a query that returns nothing, or worse,
 * returns results scored against a truncated space. Both look like "retrieval is
 * bad" rather than "the index is wrong", which is a long way to travel from the
 * symptom to the cause.
 *
 * text-embedding-3-large is 3072. If EMBEDDING_MODEL is overridden to a model of
 * a different width, this must move with it AND the committed index JSON must be
 * re-applied — see src/db/search-indexes/README.md.
 */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-large": 3072,
  "text-embedding-3-small": 1536,
  "text-embedding-ada-002": 1536,
};

/** Dimensions for the configured embedding model. */
export function embeddingDimensions(): number {
  const dimensions = EMBEDDING_DIMENSIONS[models.embedding];

  if (!dimensions) {
    throw new Error(
      `Unknown embedding model "${models.embedding}": its output width is not ` +
        "recorded in config/models.ts. Add it to EMBEDDING_DIMENSIONS and " +
        "update src/db/search-indexes/passages.json to match, or the Atlas " +
        "index and the vectors will silently disagree.",
    );
  }

  return dimensions;
}
