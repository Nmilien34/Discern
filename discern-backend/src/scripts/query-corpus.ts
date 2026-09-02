// Retrieval quality, judged from the terminal, before any AI is wired up.
//
//   npm run query -w @discern/backend -- "I can't forgive my brother"
//   npm run query -w @discern/backend -- "I feel far from God" --limit 5
//   npm run query -w @discern/backend -- --gate          # the 15 Phase 3 queries
//   npm run query -w @discern/backend -- --hymns "grace"
//
// This exists BEFORE Phase 6 on purpose. Retrieval quality is the product: if the
// right passage is not in the top few, no amount of prompt work makes Abigail
// good, it just makes her fluent about the wrong scripture. Being able to read
// the results directly is the difference between knowing that and assuming it.

import { models } from "../config/models";
import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { PassageModel } from "../models";
import { searchHymns, searchScripture } from "../services/corpus/retrieval";

/**
 * The Phase 3 gate.
 *
 * Written the way someone actually arrives — a situation in their own words, not
 * a topic. That is the whole retrieval problem: "faith is something I have to
 * build myself" shares no vocabulary with Ephesians 2:8-10, and a keyword search
 * will never find it.
 */
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

/** Query 1 must return this in the top 3, or retrieval is wrong. */
const GATE_ASSERTION = { queryIndex: 0, expected: "Ephesians 2:8-10", withinTop: 3 };

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

interface Args {
  query?: string;
  limit: number;
  gate: boolean;
  hymns: boolean;
  translation?: string;
  stageSlug?: string;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    return value && !value.startsWith("--") ? value : undefined;
  };

  const positional = argv.filter((token, index) => {
    if (token.startsWith("--")) return false;
    const previous = argv[index - 1];
    return !previous?.startsWith("--") || previous === "--gate" || previous === "--hymns";
  });

  const limitRaw = flag("limit");

  return {
    ...(positional[0] ? { query: positional[0] } : {}),
    limit: limitRaw ? Number(limitRaw) : 3,
    gate: argv.includes("--gate"),
    hymns: argv.includes("--hymns"),
    ...(flag("translation") ? { translation: flag("translation") } : {}),
    ...(flag("stage") ? { stageSlug: flag("stage") } : {}),
  };
}

async function runOne(
  query: string,
  args: Args,
  index?: number,
): Promise<string[]> {
  const label = index === undefined ? query : `${index + 1}. ${query}`;
  const lines: string[] = ["", "─".repeat(78), `QUERY  ${label}`];

  const results = await searchScripture(query, {
    limit: args.limit,
    ...(args.translation ? { translation: args.translation } : {}),
    ...(args.stageSlug ? { stageSlug: args.stageSlug } : {}),
  });

  if (results.length === 0) {
    lines.push("  (no results)");
    return lines;
  }

  results.forEach((result, rank) => {
    const ranks = [
      result.vectorRank === undefined ? null : `v${result.vectorRank}`,
      result.keywordRank === undefined ? null : `k${result.keywordRank}`,
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(
      `  ${rank + 1}. ${result.passage.reference.padEnd(26)} ` +
        `score ${result.score.toFixed(5)}  [${ranks}]`,
    );
    const author = result.passage.author?.name ?? "unknown";
    lines.push(`     ${author} · ${truncate(result.passage.text, 150)}`);
  });

  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await connectToDatabase();

  const embedded = await PassageModel.countDocuments({
    embeddingModel: models.embedding,
  });
  const total = await PassageModel.estimatedDocumentCount();

  console.log(
    `corpus: ${embedded}/${total} passages embedded with ${models.embedding}`,
  );

  if (embedded === 0) {
    console.error(
      "\nNo passages are embedded. Retrieval cannot run.\n" +
        "  Run: npm run embed -w @discern/backend\n" +
        "  (needs OPENAI_API_KEY set in the repo-root .env)",
    );
    await disconnectFromDatabase();
    process.exit(1);
  }

  if (embedded < total) {
    console.warn(
      `WARNING: ${total - embedded} passages are not embedded and are invisible ` +
        "to retrieval.",
    );
  }

  if (args.hymns) {
    const results = await searchHymns(args.query ?? "", { limit: args.limit });
    console.log(`\nHYMNS  ${args.query}`);
    results.forEach((hymn, rank) => {
      console.log(
        `  ${rank + 1}. ${hymn.title} (${hymn.author}, ${hymn.year})  ` +
          `score ${hymn.score.toFixed(5)}`,
      );
    });
    await disconnectFromDatabase();
    return;
  }

  if (args.gate) {
    const output: string[] = [];
    let assertionPassed = false;
    let assertionActual: string[] = [];

    for (const [index, query] of GATE_QUERIES.entries()) {
      const lines = await runOne(query, { ...args, limit: Math.max(args.limit, 3) }, index);
      output.push(...lines);

      if (index === GATE_ASSERTION.queryIndex) {
        const results = await searchScripture(query, { limit: GATE_ASSERTION.withinTop });
        assertionActual = results.map((result) => result.passage.reference);
        assertionPassed = assertionActual.includes(GATE_ASSERTION.expected);
      }
    }

    console.log(output.join("\n"));

    console.log("\n" + "=".repeat(78));
    console.log("GATE ASSERTION");
    console.log(
      `  Query 1 must return ${GATE_ASSERTION.expected} in the top ` +
        `${GATE_ASSERTION.withinTop}.`,
    );
    console.log(`  Top ${GATE_ASSERTION.withinTop}: ${assertionActual.join(", ")}`);
    console.log(`  RESULT: ${assertionPassed ? "PASS" : "FAIL"}`);

    if (!assertionPassed) {
      // Reported as a failure rather than quietly tolerated. The instruction was
      // explicit: if this misses, retrieval is wrong and no prompt work in
      // Phase 6 will fix it.
      console.log(
        "\n  Retrieval is not returning the passage that answers the premise " +
          "in query 1.\n  This is a retrieval problem, not a prompting problem.",
      );
    }

    await disconnectFromDatabase();
    process.exit(assertionPassed ? 0 : 1);
  }

  if (!args.query) {
    console.error('Usage: npm run query -w @discern/backend -- "your question" [--limit 5] [--gate]');
    await disconnectFromDatabase();
    process.exit(1);
  }

  console.log((await runOne(args.query, args)).join("\n"));
  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
