// Generates summary / situations / themes / stageSlugs / cautions per passage.
//
//   npm run enrich -w @discern/backend -- --sample     # the 30-passage review set
//   npm run enrich -w @discern/backend                 # everything outstanding
//   npm run enrich -w @discern/backend -- --limit 200
//   npm run enrich -w @discern/backend -- --force      # regenerate
//
// IDEMPOTENT AND RESUMABLE, on the same terms as embed-corpus: the selector is
// "never enriched, OR enriched by a different model", each batch is written
// before the next is requested, and `enrichmentModel` is recorded per document
// so a model change is detectable and re-runnable.

import { models } from "../config/models";
import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { AuthorModel, PassageModel } from "../models";
import type { PassageToEnrich } from "../services/corpus/enrichment";
import {
  buildEnrichedText,
  enrichBatch,
  ENRICHMENT_VERSION,
  estimateEnrichmentCost,
} from "../services/corpus/enrichment";

/**
 * Batches in flight at once.
 *
 * 684 sequential calls is roughly an hour of waiting on round trips, and even at
 * 6 the measured rate projected to ~98 minutes. Each batch still WRITES ITS OWN
 * RESULTS before the pool hands out the next one, so resumability is unaffected
 * by running several at a time — and the 429 backoff in enrichBatch is what lets
 * this be raised without hand-tuning against the rate limit.
 *
 * Override with ENRICH_CONCURRENCY.
 */
const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 16);

/**
 * Passages per model call. Small on purpose — a model holding twenty passages at
 * once blurs them together and the situations drift generic.
 */
const BATCH_SIZE = 6;

/**
 * The review set, read before committing to the full run.
 *
 * The five named passages are each here to answer a specific question:
 *   Ephesians 2:8-10    the gate failure. Do its situations look like query 1?
 *   Hebrews 11:1-3      what beat it. Are the two now distinguishable?
 *   Leviticus 20:5-18   the harmful result. Does it generate real cautions?
 *   Genesis 43:21-25    the "money" lexical collision. Is it honest that this
 *                       is a narrative about grain money and not about anxiety?
 *   Romans 7:12-25      the passage that SHOULD have answered query 7 and never
 *                       appeared at all. (Asked for as 7:15-25; segmentation
 *                       stores it as 7:12-25, so that is what is reviewed —
 *                       inventing the requested boundary would review something
 *                       retrieval cannot return.)
 * The rest spread across genres — law, genealogy, poetry, gospel, epistle,
 * apocalyptic — because the failure modes differ by genre.
 */
const SAMPLE_REFERENCES = [
  "Ephesians 2:8-10",
  "Hebrews 11:1-3",
  "Leviticus 20:5-18",
  "Genesis 43:21-25",
  "Romans 7:12-25",
  "Colossians 3:5-14",
  "Matthew 5:23-24",
  "James 3:13-4:3",
  "Psalms 23:1-6",
  "Psalms 88:1-18",
  "Psalms 119:1-176",
  "Isaiah 52:13-53:12",
  "John 7:53-8:11",
  "Luke 20:45-21:4",
  "Matthew 18:21-35",
  "1 Corinthians 12:31-14:1",
  "Philippians 4:10-13",
  "Ecclesiastes 1:15-18",
  "Lamentations 3:19-26",
  "Genesis 1:1-2:3",
  "2 Samuel 11:1-12:25",
  "Revelation 21:1-14",
  "Numbers 3:12-25",
  "Proverbs 6:6-11",
  "Job 7:13-21",
  "1 Timothy 6:6-10",
  "Matthew 6:25-34",
  "Galatians 5:16-26",
  "Deuteronomy 22:8-14",
  "Song of Solomon 4:1-16",
];

interface Args {
  sample: boolean;
  force: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const limitIndex = argv.indexOf("--limit");
  const limitValue = limitIndex === -1 ? undefined : argv[limitIndex + 1];

  return {
    sample: argv.includes("--sample"),
    force: argv.includes("--force"),
    ...(limitValue && !limitValue.startsWith("--")
      ? { limit: Number(limitValue) }
      : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const modelId = models.premise;

  await connectToDatabase();
  assertCorpusWritable("enrich-corpus");

  // Version participates in the selector: a prompt change produces different
  // content from the same model, and without this the backfill would treat stale
  // output as current and skip it.
  const selector = args.force
    ? {}
    : {
        $or: [
          { enrichmentModel: { $exists: false } },
          { enrichmentModel: { $ne: modelId } },
          { enrichmentVersion: { $ne: ENRICHMENT_VERSION } },
        ],
      };

  const filter = args.sample
    ? { reference: { $in: SAMPLE_REFERENCES } }
    : selector;

  const query = PassageModel.find(filter).sort({ bookSlug: 1, chapter: 1, startVerse: 1 });
  if (args.limit) query.limit(args.limit);

  const passages = await query.lean();

  if (args.sample) {
    const found = new Set(passages.map((p) => p.reference));
    const missing = SAMPLE_REFERENCES.filter((r) => !found.has(r));
    if (missing.length > 0) {
      // A named review passage that is not a stored pericope would silently drop
      // out of the sample, which is exactly the case worth knowing about.
      logger.warn(
        { missing: missing.join(", ") },
        "sample references that are not stored passages",
      );
    }
  }

  const total = await PassageModel.estimatedDocumentCount();
  logger.info(
    {
      model: modelId,
      promptVersion: ENRICHMENT_VERSION,
      toEnrich: passages.length,
      corpusTotal: total,
      mode: args.sample ? "sample" : args.force ? "force" : "incremental",
    },
    "enrichment starting",
  );

  const authorIds = [...new Set(passages.map((p) => String(p.authorId)))];
  const authors = await AuthorModel.find({ _id: { $in: authorIds } }).lean();
  const authorById = new Map(authors.map((a) => [String(a._id), a]));

  let done = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let unmatched = 0;

  const batches: (typeof passages)[] = [];
  for (let start = 0; start < passages.length; start += BATCH_SIZE) {
    batches.push(passages.slice(start, start + BATCH_SIZE));
  }

  let nextBatch = 0;

  const runOneBatch = async (batch: typeof passages): Promise<void> => {
    const input: PassageToEnrich[] = batch.map((passage) => {
      const author = authorById.get(String(passage.authorId));
      return {
        reference: passage.reference,
        text: passage.searchText ?? "",
        ...(author
          ? {
              authorName: author.name,
              authorEra: author.era,
              authorCircumstances: author.circumstances,
            }
          : {}),
      };
    });

    const result = await enrichBatch(input, modelId);
    promptTokens += result.promptTokens;
    completionTokens += result.completionTokens;

    const byReference = new Map(
      result.enrichments.map((entry) => [entry.reference, entry]),
    );

    const operations = batch.flatMap((passage) => {
      const enrichment = byReference.get(passage.reference);

      if (!enrichment) {
        // The model echoed a reference that does not match. Skipping is right:
        // writing a mismatched enrichment onto a passage is worse than none.
        unmatched += 1;
        return [];
      }

      const enrichedText = buildEnrichedText(
        enrichment,
        passage.reference,
        passage.searchText ?? "",
      );

      return [
        {
          updateOne: {
            filter: { _id: passage._id },
            update: {
              $set: {
                summary: enrichment.summary,
                situations: enrichment.situations,
                themes: enrichment.themes,
                stageSlugs: enrichment.stageSlugs,
                cautions: enrichment.cautions,
                handling: enrichment.handling,
                searchTextEnriched: enrichedText,
                enrichmentModel: modelId,
                enrichmentVersion: ENRICHMENT_VERSION,
                enrichedAt: new Date(),
              },
            },
          },
        },
      ];
    });

    if (operations.length > 0) {
      await PassageModel.bulkWrite(operations, { ordered: false });
    }

    done += batch.length;

    logger.info(
      {
        progress: `${done}/${passages.length}`,
        promptTokens,
        completionTokens,
        costUsd: Number(
          estimateEnrichmentCost(promptTokens, completionTokens, modelId).toFixed(4),
        ),
      },
      "enrichment batch written",
    );
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    for (;;) {
      const index = nextBatch;
      nextBatch += 1;
      const batch = batches[index];
      if (!batch) return;

      try {
        await runOneBatch(batch);
      } catch (error) {
        // One failed batch must not abandon the run. Its passages simply stay
        // unenriched and are picked up by the next invocation.
        logger.error(
          { err: error instanceof Error ? error.message : error, size: batch.length },
          "batch failed, continuing — re-run to pick these up",
        );
        done += batch.length;
      }
    }
  });

  await Promise.all(workers);

  const cost = estimateEnrichmentCost(promptTokens, completionTokens, modelId);

  logger.info(
    {
      model: modelId,
      enriched: done - unmatched,
      unmatched,
      promptTokens,
      completionTokens,
      costUsd: Number(cost.toFixed(4)),
      projectedFullCorpusUsd:
        done > 0 ? Number(((cost / done) * total).toFixed(2)) : 0,
    },
    "enrichment complete",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "enrichment failed — re-run to resume",
    );
    process.exit(1);
  });
}
