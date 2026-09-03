// EMBEDDING BACKFILL, as a job rather than a thing somebody remembers to run.
//
// The script (scripts/embed-corpus.ts) stays — it is the right tool for the
// initial 4,102-passage load, where a long-running foreground process with a
// progress bar is exactly what you want. This is the ongoing version: small
// batches, leased, retried, and visible in the queue like everything else.

import { logger } from "../lib/logger";
import { models } from "../config/models";
import { embedBatch } from "../services/corpus/embeddings";
import { PassageModel } from "../models";

export interface BackfillResult {
  embedded: number;
  remaining: number;
}

/**
 * Embed up to `limit` passages that have no vector.
 *
 * `embedding: { $exists: false }` and NOT `{ $size: 0 }`: the model declares
 * `default: undefined` for exactly this reason, because a Mongoose array
 * defaulting to `[]` would make every document "have" an embedding and this
 * query would match nothing forever. That bug cost a day in Phase 2.
 */
export async function embedMissingPassages(limit = 200): Promise<BackfillResult> {
  const pending = await PassageModel.find({ embedding: { $exists: false } })
    .select("reference searchText")
    .limit(limit)
    .lean();

  if (pending.length === 0) return { embedded: 0, remaining: 0 };

  const texts = pending.map((p) => p.searchText ?? "");
  const { vectors } = await embedBatch(texts);

  let embedded = 0;

  for (const [index, passage] of pending.entries()) {
    const vector = vectors[index];
    if (!vector) continue;

    await PassageModel.updateOne(
      { _id: passage._id },
      { $set: { embedding: vector, embeddingModel: models.embedding } },
    );
    embedded += 1;
  }

  const remaining = await PassageModel.countDocuments({
    embedding: { $exists: false },
  });

  logger.info({ embedded, remaining }, "embedding backfill batch");

  return { embedded, remaining };
}
