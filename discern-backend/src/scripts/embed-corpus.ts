// Embeds every passage and hymn.
//
//   npm run embed -w @discern/backend
//   npm run embed -w @discern/backend -- --dry-run      # cost estimate only
//   npm run embed -w @discern/backend -- --limit 50     # a cheap trial
//   npm run embed -w @discern/backend -- --force        # re-embed everything
//
// IDEMPOTENT AND RESUMABLE, which are two different properties and both matter:
//
//   IDEMPOTENT  the selector is "no embedding, OR embeddingModel is not the
//               currently configured model". Re-running after a complete run
//               selects nothing and costs nothing.
//   RESUMABLE   each batch is WRITTEN before the next is requested. A crash at
//               passage 3,000 leaves 3,000 embeddings in the database, and the
//               next run selects only what is left. Nothing is paid for twice.
//
// Recording `embeddingModel` per document is what makes a model change
// detectable: switching EMBEDDING_MODEL makes every existing document fail the
// selector, and this script re-embeds them without being told to.

import { models } from "../config/models";
import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { HymnModel, PassageModel } from "../models";
import { embedBatch, estimateCostUsd } from "../services/corpus/embeddings";

const BATCH_SIZE = 128;

interface Args {
  dryRun: boolean;
  force: boolean;
  limit?: number;
  /**
   * Embed `searchTextEnriched` into `embeddingEnriched` instead of the raw text.
   *
   * Two vectors per passage, kept side by side rather than one replacing the
   * other, so enrichment can be MEASURED against the baseline on the same
   * queries instead of assumed to be better.
   */
  enriched: boolean;
}

function parseArgs(argv: string[]): Args {
  const limitIndex = argv.indexOf("--limit");
  const limitValue = limitIndex === -1 ? undefined : argv[limitIndex + 1];

  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    enriched: argv.includes("--enriched"),
    ...(limitValue && !limitValue.startsWith("--")
      ? { limit: Number(limitValue) }
      : {}),
  };
}

/** Rough token count for the dry-run estimate. ~4 characters per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface EmbeddableDoc {
  id: string;
  text: string;
}

async function embedCollection(
  label: "passages" | "hymns",
  docs: EmbeddableDoc[],
  args: Args,
): Promise<{ embedded: number; tokens: number }> {
  const vectorField = args.enriched ? "embeddingEnriched" : "embedding";
  const modelField = args.enriched ? "embeddingEnrichedModel" : "embeddingModel";
  if (docs.length === 0) {
    logger.info({ collection: label }, "nothing to embed");
    return { embedded: 0, tokens: 0 };
  }

  if (args.dryRun) {
    const tokens = docs.reduce((sum, doc) => sum + estimateTokens(doc.text), 0);
    logger.info(
      {
        collection: label,
        documents: docs.length,
        estimatedTokens: tokens,
        estimatedCostUsd: Number(estimateCostUsd(tokens).toFixed(4)),
        model: models.embedding,
      },
      "DRY RUN — nothing was embedded",
    );
    return { embedded: 0, tokens };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model: import("mongoose").Model<any> =
    label === "passages" ? PassageModel : HymnModel;

  let embedded = 0;
  let tokens = 0;
  const startedAt = Date.now();

  for (let start = 0; start < docs.length; start += BATCH_SIZE) {
    const batch = docs.slice(start, start + BATCH_SIZE);

    const { vectors, tokens: batchTokens } = await embedBatch(
      batch.map((doc) => doc.text),
    );

    // WRITE BEFORE REQUESTING THE NEXT BATCH. This single ordering is what makes
    // the script resumable: a crash on the next request cannot discard what has
    // already been paid for.
    await Model.bulkWrite(
      batch.map((doc, index) => ({
        updateOne: {
          filter: { _id: doc.id },
          update: {
            $set: {
              [vectorField]: vectors[index],
              [modelField]: models.embedding,
            },
          },
        },
      })),
      { ordered: false },
    );

    embedded += batch.length;
    tokens += batchTokens;

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rate = embedded / Math.max(elapsedSeconds, 0.001);

    logger.info(
      {
        collection: label,
        progress: `${embedded}/${docs.length}`,
        tokens,
        costUsd: Number(estimateCostUsd(tokens).toFixed(4)),
        etaSeconds: Math.round((docs.length - embedded) / Math.max(rate, 0.001)),
      },
      "batch embedded",
    );
  }

  return { embedded, tokens };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await connectToDatabase();
  assertCorpusWritable("embed-corpus");

  // The selector IS the idempotency. Anything embedded by the current model is
  // already correct and is not selected.
  const modelField = args.enriched ? "embeddingEnrichedModel" : "embeddingModel";
  const vectorField = args.enriched ? "embeddingEnriched" : "embedding";
  const textField = args.enriched ? "searchTextEnriched" : "searchText";

  const selector = args.force
    ? {}
    : {
        $or: [
          { [vectorField]: { $exists: false } },
          { [modelField]: { $ne: models.embedding } },
        ],
      };

  const passageQuery = PassageModel.find(selector)
    .select(`_id ${textField}`)
    .sort({ _id: 1 });
  if (args.limit) passageQuery.limit(args.limit);

  const passages = await passageQuery.lean();

  const hymnQuery = args.enriched
    ? // Hymns are not enriched: the enrichment prompt is written for scripture.
      HymnModel.find({ _id: null })
    : HymnModel.find(selector).select("_id searchText").sort({ _id: 1 });
  if (args.limit) hymnQuery.limit(args.limit);
  const hymns = await hymnQuery.lean();

  const totalPassages = await PassageModel.estimatedDocumentCount();
  const totalHymns = await HymnModel.estimatedDocumentCount();

  logger.info(
    {
      model: models.embedding,
      passagesToEmbed: passages.length,
      passagesTotal: totalPassages,
      hymnsToEmbed: hymns.length,
      hymnsTotal: totalHymns,
      vector: args.enriched ? "embeddingEnriched" : "embedding",
      mode: args.dryRun ? "dry-run" : args.force ? "force" : "incremental",
    },
    "embedding backfill starting",
  );

  const withText = (
    docs: Record<string, unknown>[],
  ): EmbeddableDoc[] =>
    docs
      .filter((doc) => String(doc[textField] ?? "").trim().length > 0)
      .map((doc) => ({
        id: String(doc._id),
        text: String(doc[textField] ?? ""),
      }));

  const passageDocs = withText(passages);
  const hymnDocs = withText(hymns);

  const skipped =
    passages.length - passageDocs.length + (hymns.length - hymnDocs.length);
  if (skipped > 0) {
    // An empty searchText means segmentation has not been re-run since the field
    // was added. Embedding "" would produce a valid vector for nothing.
    logger.warn(
      { skipped },
      args.enriched
        ? "documents skipped: no searchTextEnriched. Run `npm run enrich` first"
        : "documents skipped: no searchText. Re-run `npm run segment` first",
    );
  }

  const passageResult = await embedCollection("passages", passageDocs, args);
  const hymnResult = await embedCollection("hymns", hymnDocs, args);

  const tokens = passageResult.tokens + hymnResult.tokens;
  const cost = estimateCostUsd(tokens);

  logger.info(
    {
      model: models.embedding,
      documentsEmbedded: passageResult.embedded + hymnResult.embedded,
      tokens,
      costUsd: Number(cost.toFixed(4)),
      note: args.dryRun
        ? "DRY RUN — estimate only, tokens approximated at 4 chars/token"
        : "billed tokens as reported by the API",
    },
    args.dryRun ? "dry run complete" : "embedding backfill complete",
  );

  if (!args.dryRun) {
    const remaining = await PassageModel.countDocuments({
      $or: [
        { [vectorField]: { $exists: false } },
        { [modelField]: { $ne: models.embedding } },
      ],
    });

    if (remaining > 0) {
      logger.warn(
        { remaining },
        "passages still unembedded — re-run to resume; nothing is paid for twice",
      );
    } else {
      logger.info("every passage is embedded with the current model");
    }
  }

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "embedding backfill failed — re-run to resume from where it stopped",
    );
    process.exit(1);
  });
}
