// Re-classifies ONLY the `handling` field. DEFERRED.md item 1.
//
//   npm run reclassify:handling -w @discern/backend
//   npm run reclassify:handling -w @discern/backend -- --dry-run
//
// The measured problem: `open` was 49.0% and `care` 46.4%, because the enricher
// marked `care` whenever ANY caution existed — and cautions fire on 3,963 of
// 4,102 passages. A field present on 97% of the corpus cannot discriminate, and
// a Phase 6 filter written against it would gate half the Bible.
//
// This touches NOTHING ELSE. Summaries, situations, themes, stageSlugs and
// cautions are good and cost $5.37; they are read as INPUT here and never
// rewritten. Only `handling` is updated.
//
// `on-request-only` is already well calibrated (4.6%, and it caught Saul's
// mutilation and Psalm 69's imprecatory curses unprompted), so those are left
// alone entirely — only the `care` pile is re-examined.

import OpenAI from "openai";

import { env } from "../config/env";
import { models } from "../config/models";
import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { PassageModel } from "../models";
import { estimateEnrichmentCost } from "../services/corpus/enrichment";

const BATCH_SIZE = 12;
const CONCURRENCY = Number(process.env.RECLASSIFY_CONCURRENCY ?? 12);

const SYSTEM_PROMPT = `You are auditing one field for a Christian app's scripture retrieval.

For each passage decide ONLY this: may it be shown, UNPROMPTED, to someone who
opened the app in distress and did not ask for it?

Answer with exactly one of: open | care

THE BAR FOR "care" IS HIGH AND SPECIFIC. Choose it ONLY if, handed cold to a
struggling person, the passage would most likely:
  - read as an ACCUSATION OF THEM personally — a rebuke that lands on the reader
    rather than on its original audience, or
  - promise a rescue, healing or prosperity that their situation is currently
    contradicting, in a way that would feel like mockery, or
  - describe punishment or exclusion in a way a self-condemning person would
    apply to themselves.

EVERYTHING ELSE IS "open". This is the large majority of scripture and you should
say open far more often than care.

Say OPEN even when:
  - the subject matter is dark. Job's despair, Lamentations' grief, Psalm 88's
    unrelieved darkness are ALL open. Meeting someone in that place is the point
    of the book and of this app.
  - the passage is a rebuke aimed at kings, nations, false prophets or religious
    leaders. A judgement on Tyre is not an accusation of the reader.
  - it is law, genealogy, census, ritual instruction, or architecture. Dull is
    not dangerous.
  - it is a warning or a command. Being told to do something is not an attack.
  - a caution exists about it. ALMOST EVERY PASSAGE HAS A CAUTION. A caution
    describes a reader it might not suit; it is not a reason to withhold it from
    everyone. THIS IS THE MISTAKE THE LAST PASS MADE — do not repeat it.

You are being asked to protect people from a specific kind of harm, not to
curate scripture for comfort. Withholding ordinary text makes the flag useless
and hides the passages that genuinely need it.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passages"],
  properties: {
    passages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reference", "handling"],
        properties: {
          reference: { type: "string" },
          handling: { type: "string", enum: ["open", "care"] },
        },
      },
    },
  },
} as const;

let client: OpenAI | null = null;
const getClient = (): OpenAI =>
  (client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY }));

interface Candidate {
  reference: string;
  summary: string;
  cautions: string[];
  text: string;
}

async function classifyBatch(
  batch: Candidate[],
  modelId: string,
): Promise<{
  results: Map<string, "open" | "care">;
  promptTokens: number;
  completionTokens: number;
}> {
  const content = batch
    .map(
      (p, i) =>
        `--- ${i + 1} ---\nReference: ${p.reference}\nWhat it is: ${p.summary}\n` +
        `Existing cautions (context only, NOT a reason to choose care): ${
          p.cautions.join(" | ") || "none"
        }\nText: ${p.text.slice(0, 700)}`,
    )
    .join("\n\n");

  const response = await getClient().chat.completions.create({
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Classify these ${batch.length} passages. Echo each reference exactly.\n\n${content}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "handling", strict: true, schema: RESPONSE_SCHEMA },
    },
    max_completion_tokens: 8_000,
  });

  const parsed = JSON.parse(
    response.choices[0]?.message?.content ?? '{"passages":[]}',
  ) as { passages: { reference: string; handling: "open" | "care" }[] };

  return {
    results: new Map(parsed.passages.map((p) => [p.reference, p.handling])),
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const modelId = models.premise;

  await connectToDatabase();
  assertCorpusWritable("reclassify-handling");

  // ONLY the `care` pile. `on-request-only` is well calibrated and is not
  // re-examined; `open` is already the answer this pass is trying to reach.
  const candidates = await PassageModel.find({ handling: "care" })
    .select("reference summary cautions searchText")
    .lean();

  const total = await PassageModel.estimatedDocumentCount();

  logger.info(
    { toReclassify: candidates.length, corpusTotal: total, model: modelId },
    "handling reclassification starting (handling ONLY; nothing else is touched)",
  );

  if (dryRun) {
    logger.info("dry run: nothing was written");
    await disconnectFromDatabase();
    return;
  }

  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(
      candidates.slice(i, i + BATCH_SIZE).map((p) => ({
        reference: p.reference,
        summary: p.summary ?? "",
        cautions: p.cautions ?? [],
        text: p.searchText ?? "",
      })),
    );
  }

  let done = 0;
  let toOpen = 0;
  let stayedCare = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const batch = batches[next++];
      if (!batch) return;

      try {
        const { results, promptTokens: pt, completionTokens: ct } =
          await classifyBatch(batch, modelId);
        promptTokens += pt;
        completionTokens += ct;

        const ops = batch.flatMap((candidate) => {
          const verdict = results.get(candidate.reference);
          if (!verdict) return [];

          if (verdict === "open") toOpen += 1;
          else stayedCare += 1;

          return [
            {
              updateOne: {
                filter: { reference: candidate.reference },
                // ONLY handling. Nothing else in the document is touched.
                update: { $set: { handling: verdict } },
              },
            },
          ];
        });

        if (ops.length > 0) await PassageModel.bulkWrite(ops, { ordered: false });
        done += batch.length;

        if (done % 240 === 0) {
          logger.info(
            { progress: `${done}/${candidates.length}`, toOpen, stayedCare },
            "reclassifying",
          );
        }
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : error },
          "batch failed; those passages keep their current handling",
        );
        done += batch.length;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker),
  );

  const counts = await Promise.all(
    (["open", "care", "on-request-only"] as const).map(async (h) => ({
      handling: h,
      count: await PassageModel.countDocuments({ handling: h }),
    })),
  );

  logger.info(
    {
      reclassified: done,
      movedToOpen: toOpen,
      stayedCare,
      promptTokens,
      completionTokens,
      costUsd: Number(
        estimateEnrichmentCost(promptTokens, completionTokens, modelId).toFixed(4),
      ),
      distribution: counts
        .map((c) => `${c.handling}=${c.count} (${((c.count / total) * 100).toFixed(1)}%)`)
        .join("  "),
    },
    "handling reclassification complete",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "reclassification failed",
    );
    process.exit(1);
  });
}
