// Runs the 15 gate queries in all four configurations and puts them side by side.
//
//   npm run compare -w @discern/backend            # the summary table
//   npm run compare -w @discern/backend -- --full  # every result, all configs
//
// The point is to MEASURE rather than assume. Enrichment and query rewriting are
// each plausible; plausible is not evidence, and both cost money to run and
// latency to serve. The comparison is over an identical query list, an identical
// bar, and an identical judgement.

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { PassageModel } from "../models";
import { searchScripture } from "../services/corpus/retrieval";

/** VERBATIM from query-corpus.ts. Not edited, not reordered, not swapped. */
const GATE_QUERIES = [
  "faith is something I have to build myself",
  "I can't forgive my brother",
  "I feel far from God",
  "I keep comparing myself to my friends and I hate it",
  "I lost my temper again",
  "I have money but I'm still afraid",
  "I know what I should do and I don't do it",
  "my prayers feel like they hit the ceiling",
  "someone I love died",
  "I did something I can't tell anyone about",
  "why does God let this happen",
  "I'm proud of myself and I don't know if that's wrong",
  "I can't stop wanting what I shouldn't want",
  "everyone at church seems more sure than me",
  "what do I do when a sermon confuses me",
];

const GATE_EXPECTED = { query: GATE_QUERIES[0], reference: "Ephesians 2:8-10", topN: 3 };

/** The harmful result from the baseline run — tracked, not hoped away. */
const HARM_WATCH = { queryIndex: 13, reference: "Leviticus 20:5-18" };

const CONFIGS = [
  { key: "raw+raw", label: "raw query + raw embedding", useEnriched: false, rewriteQuery: false },
  { key: "raw+enr", label: "raw query + enriched embedding", useEnriched: true, rewriteQuery: false },
  { key: "hyde+raw", label: "rewritten query + raw embedding", useEnriched: false, rewriteQuery: true },
  { key: "hyde+enr", label: "rewritten query + enriched embedding", useEnriched: true, rewriteQuery: true },
] as const;

interface Cell {
  references: string[];
  handling: (string | undefined)[];
  stageHits: number;
}

async function main(): Promise<void> {
  const full = process.argv.includes("--full");

  await connectToDatabase();

  const results = new Map<string, Cell[]>();

  for (const config of CONFIGS) {
    const cells: Cell[] = [];

    for (const query of GATE_QUERIES) {
      const found = await searchScripture(query, {
        limit: 3,
        useEnriched: config.useEnriched,
        rewriteQuery: config.rewriteQuery,
      });

      const references = found.map((result) => result.passage.reference);

      // handling is deliberately not part of PassageResponse (it is a signal for
      // the retriever, not copy for a reader), so it is read back here.
      const docs = await PassageModel.find({ reference: { $in: references } })
        .select("reference handling stageSlugs")
        .lean();
      const byReference = new Map(docs.map((doc) => [doc.reference, doc]));

      cells.push({
        references,
        handling: references.map((reference) => byReference.get(reference)?.handling),
        stageHits: references.filter(
          (reference) => (byReference.get(reference)?.stageSlugs ?? []).length > 0,
        ).length,
      });
    }

    results.set(config.key, cells);
  }

  if (full) {
    for (const [index, query] of GATE_QUERIES.entries()) {
      console.log("\n" + "═".repeat(94));
      console.log(`${index + 1}. ${query}`);
      for (const config of CONFIGS) {
        const cell = results.get(config.key)?.[index];
        console.log(`\n  ${config.label}`);
        cell?.references.forEach((reference, rank) => {
          const handling = cell.handling[rank];
          const flag = handling && handling !== "open" ? `  <${handling}>` : "";
          console.log(`    ${rank + 1}. ${reference}${flag}`);
        });
      }
    }
    console.log("");
  }

  // ---- Summary table -------------------------------------------------------
  const width = 30;
  console.log("\n" + "═".repeat(94));
  console.log("TOP RESULT PER QUERY, BY CONFIGURATION\n");
  console.log(
    "  #  " +
      CONFIGS.map((config) => config.key.padEnd(width)).join("") ,
  );

  for (const [index, query] of GATE_QUERIES.entries()) {
    const row = CONFIGS.map((config) => {
      const cell = results.get(config.key)?.[index];
      const top = cell?.references[0] ?? "-";
      const handling = cell?.handling[0];
      const flag = handling && handling !== "open" ? "*" : "";
      return (top + flag).slice(0, width - 1).padEnd(width);
    }).join("");
    console.log(`  ${String(index + 1).padStart(2)} ${row}`);
    if (index === 0) console.log(`     "${query}"`);
  }

  console.log("\n  (* = handling is not 'open')");

  // ---- The gate ------------------------------------------------------------
  console.log("\n" + "═".repeat(94));
  console.log(`GATE: query 1 must return ${GATE_EXPECTED.reference} in the top ${GATE_EXPECTED.topN}\n`);

  for (const config of CONFIGS) {
    const cell = results.get(config.key)?.[0];
    const rank = (cell?.references ?? []).indexOf(GATE_EXPECTED.reference);
    const pass = rank !== -1 && rank < GATE_EXPECTED.topN;
    console.log(
      `  ${config.label.padEnd(38)} ${pass ? "PASS" : "FAIL"}` +
        (rank !== -1 ? `  (rank ${rank + 1})` : "  (not in top 3)"),
    );
  }

  // ---- Stage skew ----------------------------------------------------------
  console.log("\n" + "═".repeat(94));
  console.log("STAGE SKEW: results (of 45) whose passage carries at least one stage\n");
  for (const config of CONFIGS) {
    const total = (results.get(config.key) ?? []).reduce(
      (sum, cell) => sum + cell.stageHits,
      0,
    );
    console.log(`  ${config.label.padEnd(38)} ${total}/45`);
  }

  // ---- Harm watch ----------------------------------------------------------
  console.log("\n" + "═".repeat(94));
  console.log(
    `HARM WATCH: does ${HARM_WATCH.reference} still appear for query ` +
      `${HARM_WATCH.queryIndex + 1} ("${GATE_QUERIES[HARM_WATCH.queryIndex]}")?\n`,
  );
  for (const config of CONFIGS) {
    const cell = results.get(config.key)?.[HARM_WATCH.queryIndex];
    const rank = (cell?.references ?? []).indexOf(HARM_WATCH.reference);
    console.log(
      `  ${config.label.padEnd(38)} ${rank === -1 ? "absent" : `PRESENT at rank ${rank + 1}`}`,
    );
  }

  // How many non-'open' passages surface at all, across every config.
  console.log("\n  non-'open' passages surfaced across all 45 results:");
  for (const config of CONFIGS) {
    const cells = results.get(config.key) ?? [];
    const flagged = cells.flatMap((cell) =>
      cell.handling.filter((h) => h && h !== "open"),
    );
    const restricted = cells.flatMap((cell) =>
      cell.handling.filter((h) => h === "on-request-only"),
    );
    console.log(
      `    ${config.label.padEnd(38)} care+restricted ${flagged.length}` +
        `   of which on-request-only: ${restricted.length}`,
    );
  }

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
