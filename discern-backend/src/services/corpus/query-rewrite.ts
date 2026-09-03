// HyDE — Hypothetical Document Embeddings.
//
// The query side of the same asymmetry enrichment attacks from the document
// side. A person types "faith is something I have to build myself"; the corpus
// says "for by grace you have been saved through faith, and that not of
// yourselves". Those two sentences are about the same thing and share almost no
// surface. Embedding them lands them in different neighbourhoods.
//
// HyDE closes the gap by not embedding the question at all. It asks a cheap model
// to write what a passage answering that person would plausibly SAY, and embeds
// that instead. The hypothetical text is usually wrong in its particulars — it is
// not scripture and is never shown to anyone — but it is wrong in the same
// register as the corpus, which is the only property that matters here.
//
// Kept behind a flag so it can be measured on and off rather than assumed.

import OpenAI from "openai";

import { effort, models } from "../../config/models";
import { logger } from "../../lib/logger";
import { openaiFor } from "../../lib/openai-client";

const SYSTEM_PROMPT = `You help a scripture search engine.

You are given something a person said about their life, in their own words. Write
2-3 sentences of the kind of scripture passage that would genuinely speak to it —
in the register of an English Bible translation, using the vocabulary and cadence
scripture actually uses.

Do NOT quote a real verse, cite a reference, or try to remember a specific
passage. Write plausible scripture-shaped prose about the thing underneath what
they said. This text is never shown to anyone; it is only used to find real
passages, so being representative matters more than being accurate.

Answer the assumption underneath the sentence, not only its surface. If someone
says they must build their own faith, write about grace given rather than earned.
If someone says they have money and are still afraid, write about anxiety and
provision rather than about wealth.

Output only the passage-like text.`;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = openaiFor("hyde");
  return client;
}

/**
 * Rewrites a user's sentence into hypothetical scripture-shaped text.
 *
 * Returns the ORIGINAL query on any failure. Retrieval degrading to its
 * un-rewritten behaviour is a far better outcome than a search that throws
 * because a rewrite model was briefly unavailable.
 */
export interface QueryRewriteResult {
  /** The text to embed. The ORIGINAL query when the rewrite failed. */
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Usage is returned, not swallowed.
 *
 * This call was invisible to every cost report until 2026-09-02: it happens
 * inside retrieval, two layers below the pipeline that assembles TurnResult
 * .costs, and it never read `response.usage`. It runs 2-3 times per turn, so
 * every per-conversation figure produced before that date — including the
 * $0.0422 reported as meeting the $0.04 target — was understated.
 */
export async function rewriteQueryForRetrieval(
  query: string,
): Promise<QueryRewriteResult> {
  try {
    const response = await getClient().chat.completions.create({
      model: models.hyde,
      reasoning_effort: effort.hyde,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      // HARD CAP. 4,000 was sized for a reasoning model that spends most of its
      // budget before emitting anything; at minimal effort the measured output
      // is ~85 tokens. 800 leaves an order of magnitude of headroom and bounds
      // the worst case, and an empty result falls back to the original query
      // rather than failing the search.
      max_completion_tokens: 800,
    });

    const usage = {
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };

    const text = response.choices[0]?.message?.content?.trim();

    if (!text) {
      logger.warn(
        { finishReason: response.choices[0]?.finish_reason },
        "query rewrite returned nothing; using the original query",
      );
      return { text: query, model: models.hyde, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
    }

    // Both, not just the rewrite. The hypothetical text can drift off-topic, and
    // keeping the original anchors the embedding to what was actually asked.
    return {
      text: `${query}\n${text}`,
      model: models.hyde,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
    };
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "query rewrite failed; using the original query",
    );
    return { text: query, model: models.hyde, tokensIn: 0, tokensOut: 0 };
  }
}
