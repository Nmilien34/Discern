// Embedding generation.
//
// Model comes from config/models.ts, never a literal (CONVENTIONS.md §2).
//
// Three properties the backfill depends on, and which are the whole reason this
// is a service rather than an inline call:
//
//  BATCHED       one request per N inputs, not per passage. 4,100 individual
//                requests would take an hour of round trips and hit rate limits
//                that batching never touches.
//  RATE-LIMIT    429 and 5xx are retried with exponential backoff and honour
//   AWARE        Retry-After. A rate limit is a wait, not a failure.
//  RESUMABLE     nothing here holds state. The caller writes each batch as it
//                completes, so a crash at passage 3,000 resumes from 3,000 —
//                see scripts/embed-corpus.ts.

import OpenAI from "openai";

import { env } from "../../config/env";
import { embeddingDimensions, models } from "../../config/models";
import { logger } from "../../lib/logger";

/**
 * Inputs per request.
 *
 * OpenAI accepts up to 2048 inputs, but the real ceiling is the 300k-token
 * per-request limit. Passages average ~300 tokens, so 128 keeps a batch around
 * 38k tokens — comfortably inside the limit even for Psalm 119, and small enough
 * that one failed batch is a cheap retry rather than a lost minute.
 */
const BATCH_SIZE = 128;

const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1_000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

export interface EmbeddingBatchResult {
  vectors: number[][];
  /** Prompt tokens billed for this batch. */
  tokens: number;
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  // 429 rate limit, 408 timeout, and any 5xx. A 400 means the input is wrong and
  // retrying it just wastes the budget.
  return status === 429 || status === 408 || (status !== undefined && status >= 500);
}

function retryAfterMs(error: unknown, attempt: number): number {
  const headers = (error as { headers?: Record<string, string> })?.headers;
  const header = headers?.["retry-after"];

  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  // Exponential with jitter. Jitter matters when several batches fail at once:
  // without it they all retry on the same tick and rate-limit each other again.
  const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return backoff + Math.floor(Math.random() * 250);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Embeds one batch, retrying transient failures. */
export async function embedBatch(
  inputs: string[],
): Promise<EmbeddingBatchResult> {
  if (inputs.length === 0) return { vectors: [], tokens: 0 };

  const expectedDimensions = embeddingDimensions();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await getClient().embeddings.create({
        model: models.embedding,
        input: inputs,
      });

      // The API returns results with an `index`, and it is not guaranteed to be
      // in request order. Sorting is what keeps vector[i] attached to input[i] —
      // getting this wrong attaches every embedding to the wrong passage, and
      // nothing about the output looks broken.
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      const vectors = sorted.map((item) => item.embedding);

      const wrongWidth = vectors.find(
        (vector) => vector.length !== expectedDimensions,
      );
      if (wrongWidth) {
        throw new Error(
          `Model "${models.embedding}" returned ${wrongWidth.length}-dimension ` +
            `vectors, but config/models.ts expects ${expectedDimensions}. The ` +
            "Atlas index would silently disagree with the data.",
        );
      }

      return { vectors, tokens: response.usage?.prompt_tokens ?? 0 };
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;

      const wait = retryAfterMs(error, attempt);
      logger.warn(
        {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          waitMs: wait,
          status: (error as { status?: number })?.status,
        },
        "embedding request failed, retrying",
      );
      await sleep(wait);
    }
  }

  throw new Error("unreachable: embedBatch exhausted its retry loop");
}

/**
 * Embeds many texts, yielding each batch as it completes.
 *
 * A generator rather than a Promise<number[][]> so the caller can PERSIST AS IT
 * GOES. Returning everything at the end would mean a failure at input 3,000
 * discards 3,000 successful embeddings and the money spent on them.
 */
export async function* embedInBatches(
  texts: string[],
  batchSize = BATCH_SIZE,
): AsyncGenerator<{ startIndex: number; vectors: number[][]; tokens: number }> {
  for (let start = 0; start < texts.length; start += batchSize) {
    const slice = texts.slice(start, start + batchSize);
    const { vectors, tokens } = await embedBatch(slice);
    yield { startIndex: start, vectors, tokens };
  }
}

/** Embeds a single query. Used by retrieval, one call per search. */
export async function embedQuery(query: string): Promise<number[]> {
  const { vectors } = await embedBatch([query]);
  const vector = vectors[0];

  if (!vector) {
    throw new Error("Embedding request returned no vector for the query.");
  }

  return vector;
}

/**
 * USD per 1M tokens, for the run report.
 *
 * Published prices as of the Phase 3 build; they are a REPORTING aid, not a
 * billing source. If they drift, the token count in the report is still exact
 * and the dollar figure is the estimate.
 */
const PRICE_PER_MILLION_TOKENS: Record<string, number> = {
  "text-embedding-3-large": 0.13,
  "text-embedding-3-small": 0.02,
  "text-embedding-ada-002": 0.1,
};

export function estimateCostUsd(tokens: number, model = models.embedding): number {
  const rate = PRICE_PER_MILLION_TOKENS[model];
  if (rate === undefined) return Number.NaN;
  return (tokens / 1_000_000) * rate;
}
