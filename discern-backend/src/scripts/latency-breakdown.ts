// WHERE THE NINETY SECONDS GOES. Makes real calls; costs a little real money.
//
//   npm run latency -w @discern/backend
//   npm run latency -w @discern/backend -- --turns 12
//
// A turn takes about a minute and a half and nobody waits that long on a phone
// at 11pm. Before anyone optimises anything, this says WHICH part is slow, and
// specifically whether it is the part that moves when the process runs next to
// its database (Atlas, network) or the part that does not (OpenAI round trips).
//
// RUN IT FROM WHEREVER THE QUESTION IS ABOUT. From a laptop the Atlas and
// embedding numbers include a home-broadband round trip to the cluster region;
// from a Render instance in the same region they do not. The OpenAI numbers are
// a public API call either way and should barely move. That difference is the
// whole point of running it in both places.

import { models } from "../config/models";
import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { ConversationModel, UserModel } from "../models";
import { embedQuery } from "../services/corpus/embeddings";
import { rewriteQueryForRetrieval } from "../services/corpus/query-rewrite";
import { searchScripture } from "../services/corpus/retrieval";
import { persistTurn, runTurn } from "../services/abigail/pipeline";
import mongoose from "mongoose";

/** Realistic queries — what she actually sends the retrieval layer. */
const QUERIES = [
  "someone who feels far from God and is not sure he is listening",
  "a person carrying guilt over words they cannot take back",
  "envy of a friend's success and the shame that follows it",
  "grief that keeps arriving in ordinary moments",
  "wanting reassurance that things will turn out well",
];

/** Full turns, for end-to-end latency. Deliberately the eval's own inputs. */
const TURNS = [
  "I keep comparing myself to my friends and I hate it",
  "my mother died three weeks ago and I keep forgetting she's gone",
  "I just want someone to tell me it's going to be okay",
  "I said something cruel to my wife two days ago and I've been avoiding her since",
  "some days I'm not sure any of this is real and I feel like a fraud",
  "I've been meaning to look for a new job for eight months",
];

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const at = Date.now();
  const value = await fn();
  return [value, Date.now() - at];
}

function stats(samples: number[]): {
  n: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  mean: number;
} {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;

  return {
    n: s.length,
    p50: at(0.5),
    p90: at(0.9),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
    mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
  };
}

function row(label: string, samples: number[], note = ""): void {
  if (samples.length === 0) {
    console.log(`  ${label.padEnd(34)} (no samples)`);
    return;
  }
  const t = stats(samples);
  console.log(
    `  ${label.padEnd(34)} p50 ${String(Math.round(t.p50)).padStart(6)}ms   ` +
      `p90 ${String(Math.round(t.p90)).padStart(6)}ms   ` +
      `mean ${String(Math.round(t.mean)).padStart(6)}ms   ` +
      `n=${String(t.n).padStart(2)}  ${note}`,
  );
}

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertCorpusWritable("latency-breakdown");

  const turnCount = Number(argOf("--turns") ?? TURNS.length);

  console.log("\n" + "═".repeat(94));
  console.log("LATENCY BREAKDOWN");
  console.log(`  host             ${process.env.RENDER_SERVICE_NAME ?? "local"}`);
  console.log(`  region           ${process.env.RENDER_REGION ?? "(not on Render)"}`);
  console.log(`  mongo            ${mongoose.connection.host ?? "?"}`);
  console.log(
    `  models           safety=${models.safety} premise=${models.premise} ` +
      `conversation=${models.conversation} reasoning=${models.reasoning}`,
  );

  // ── PART 1. The pieces inside ONE search_scripture call.
  //
  // She calls this several times a turn, so anything here is multiplied by the
  // round count before it reaches the person waiting.
  console.log("\n" + "─".repeat(94));
  console.log("ONE search_scripture CALL, BY PART\n");

  const hyde: number[] = [];
  const embed: number[] = [];
  const search: number[] = [];

  for (const query of QUERIES) {
    // HyDE is a full model round trip that happens BEFORE the embedding, on
    // every search. It is easy to forget it is a model call at all.
    const [rewritten, hydeMs] = await timed(() => rewriteQueryForRetrieval(query));
    hyde.push(hydeMs);

    const [, embedMs] = await timed(() => embedQuery(rewritten));
    embed.push(embedMs);

    // The whole call, so the Atlas + fusion + hydration remainder can be got by
    // subtraction rather than by threading a timer through the retrieval path.
    const [, searchMs] = await timed(() =>
      searchScripture(query, { limit: 5 }),
    );
    search.push(searchMs);
  }

  const atlas = search.map(
    (total, i) => total - (hyde[i] ?? 0) - (embed[i] ?? 0),
  );

  row("HyDE query rewrite", hyde, "OpenAI — does NOT move with hosting");
  row("query embedding", embed, "OpenAI");
  row("Atlas search + hydrate", atlas, "MOVES with hosting");
  row("FULL search_scripture", search, "");

  // ── PART 2. Whole turns.
  console.log("\n" + "─".repeat(94));
  console.log("FULL TURNS, END TO END\n");

  const totals: number[] = [];
  const rounds: number[] = [];
  const perRound: number[] = [];

  for (const input of TURNS.slice(0, turnCount)) {
    const user = await UserModel.create({ deviceId: `lat-${Date.now()}` });
    const conversation = await ConversationModel.create({
      userId: user._id,
      mode: "text",
    });

    const result = await runTurn(user._id, conversation._id, input);
    await persistTurn(user._id, conversation._id, input, result);

    totals.push(result.latencyMs);
    rounds.push(result.reasoningRounds);
    if (result.reasoningRounds > 0) {
      perRound.push(result.latencyMs / result.reasoningRounds);
    }

    console.log(
      `  ${String(Math.round(result.latencyMs / 1000)).padStart(3)}s  ` +
        `${result.reasoningRounds} rounds  ${result.toolCalls.length} tools  ` +
        `${result.modelUsed.padEnd(11)} "${input.slice(0, 44)}..."`,
    );

    await mongoose.connection
      .collection("users")
      .deleteOne({ _id: user._id as never });
  }

  console.log("");
  row("TOTAL TURN", totals, "<- the number a person feels");
  row("per reasoning round", perRound, "");
  console.log(
    `  ${"reasoning rounds".padEnd(34)} p50 ${String(Math.round(stats(rounds).p50)).padStart(6)}     ` +
      `p90 ${String(Math.round(stats(rounds).p90)).padStart(6)}     ` +
      `mean ${stats(rounds).mean.toFixed(1)}`,
  );

  // ── The attribution, stated rather than left to be inferred.
  const t = stats(totals);
  const searchShare = stats(search).p50;
  const atlasShare = stats(atlas).p50;
  const hydeShare = stats(hyde).p50;

  console.log("\n" + "─".repeat(94));
  console.log("WHERE IT GOES, AT p50\n");
  console.log(`  a turn is ${Math.round(t.p50 / 1000)}s and spends ${stats(rounds).p50} rounds.`);
  console.log(
    `  each search costs ${Math.round(searchShare)}ms, of which ${Math.round(atlasShare)}ms ` +
      `is Atlas (moves with hosting)`,
  );
  console.log(
    `  and ${Math.round(hydeShare)}ms is the HyDE model call (does not move).`,
  );
  console.log(
    `  the remainder — ${Math.round(t.p50 - stats(perRound).p50)}ms+ — is the reasoning model itself.`,
  );

  if (t.p50 > 30_000) {
    console.log("");
    console.log(
      `  OVER THE 30s BAR. p50 is ${Math.round(t.p50 / 1000)}s. This is a product` +
        " problem, not a hosting one, unless Atlas dominates above.",
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
