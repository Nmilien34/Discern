// PREGENERATE THE STAGE ANCHORS. Nothing else.
//
//   npm run speech:pregen -w @discern/backend               # estimate only
//   npm run speech:pregen -w @discern/backend -- --run
//
// RULING, 2026-09-03: pregenerate the 56 stage anchors and NOT the corpus.
// Synthesizing all 4,102 passages costs $1,173 to produce audio for thousands
// of passages that will never be played — spending ahead of need, and the cache
// makes it unnecessary: any passage anyone actually opens is synthesized once,
// on demand, and free to every listener after that.
//
// The anchors are the exception because they are the passages the journey is
// built on, so they are the ones most certain to be heard.
//
// STILL DEFAULTS TO A DRY RUN. It spends money.

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { env } from "../config/env";
import { PassageModel, SpeechCacheModel, StageModel } from "../models";
import { speakable } from "../services/speech/sentences";
import { synthesize } from "../services/speech/tts";

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main(): Promise<void> {
  await connectToDatabase();

  const run = process.argv.includes("--run");
  const limit = Number(argOf("--limit") ?? 0);

  // ANCHORS ONLY. `--all` exists so the corpus estimate can still be printed,
  // but it is not what this script is for.
  const anchorsOnly = !process.argv.includes("--all");

  // THE CURATED ANCHORS, from the stages themselves — NOT `passages.stageSlugs`.
  //
  // That field is the enrichment's pastoral-fit tagging and covers 1,712
  // passages; using it here would have pregenerated a third of the corpus and
  // called it "the anchors". The anchors are the ~52 references the seven
  // stages are actually built on.
  const anchors = anchorsOnly
    ? [
        ...new Set(
          (await StageModel.find({}).select("anchorPassages").lean()).flatMap(
            (stage) => stage.anchorPassages,
          ),
        ),
      ]
    : null;

  const passages = await PassageModel.find(
    anchors ? { reference: { $in: anchors } } : {},
  )
    .select("reference texts stageSlugs handling")
    .lean();

  if (anchors) {
    const found = new Set(passages.map((p) => p.reference));
    const absent = anchors.filter((a) => !found.has(a));
    if (absent.length > 0) {
      // Worth saying rather than silently pregenerating fewer: an anchor with
      // no stored passage is a stage that cannot hand over its own foundation.
      console.log(`  NOTE: ${absent.length} anchors are not stored passages: ${absent.slice(0, 5).join(", ")}`);
    }
  }

  const already = new Set(
    (await SpeechCacheModel.find({ passageReference: { $ne: null } })
      .select("passageReference")
      .lean()).map((r) => r.passageReference),
  );

  let totalChars = 0;
  let counted = 0;
  const work: { reference: string; text: string }[] = [];

  for (const p of passages) {
    // on-request-only passages are never handed over unprompted, so they are
    // never read aloud unprompted either.
    if (p.handling === "on-request-only") continue;
    if (already.has(p.reference)) continue;

    const texts = p.texts as unknown as Map<string, string> | Record<string, string>;
    const first =
      texts instanceof Map
        ? [...texts.values()][0]
        : Object.values(texts ?? {})[0];

    const text = speakable(String(first ?? ""));
    if (!text) continue;

    totalChars += text.length;
    counted += 1;
    work.push({ reference: p.reference, text });
  }

  const usd = (totalChars / 1000) * env.TTS_USD_PER_1K_CHARS;

  console.log("\n" + "═".repeat(80));
  console.log(
    anchorsOnly ? "STAGE ANCHOR PREGENERATION" : "FULL CORPUS (estimate only)",
  );
  console.log(`  passages not yet cached   ${counted}`);
  console.log(`  characters                ${totalChars.toLocaleString()}`);
  console.log(`  estimated cost            $${usd.toFixed(2)}  at $${env.TTS_USD_PER_1K_CHARS}/1k`);
  console.log(`  already cached            ${already.size}`);

  if (!run) {
    console.log("");
    console.log("  DRY RUN. Nothing was synthesized and nothing was spent.");
    console.log("  Add --run to proceed, and --limit N to bound it.");
    console.log("");
    console.log("  Note: the cache fills itself as passages are actually used,");
    console.log("  at no cost beyond the first listener. Pregeneration only buys");
    console.log("  the first listener a faster start, which is why only the");
    console.log("  stage anchors are worth it.");
    await disconnectFromDatabase();
    return;
  }

  const batch = limit > 0 ? work.slice(0, limit) : work;
  const spent = (batch.reduce((n, w) => n + w.text.length, 0) / 1000) * env.TTS_USD_PER_1K_CHARS;

  console.log("");
  console.log(`  SYNTHESIZING ${batch.length} passages, about $${spent.toFixed(2)}`);

  let done = 0;
  let failed = 0;

  for (const item of batch) {
    // "pregen" is not a real user; it has its own ceiling scope so warming the
    // cache can never consume a person's daily allowance.
    const result = await synthesize(item.text, "pregen", {
      passageReference: item.reference,
    });

    if (!result || result.refusedReason) {
      failed += 1;
      console.log(`    FAILED ${item.reference}: ${result?.refusedReason ?? "no result"}`);
      // A ceiling refusal will refuse everything after it too.
      if (result?.refusedReason) break;
    } else {
      done += 1;
      if (done % 10 === 0) console.log(`    ${done}/${batch.length}`);
    }
  }

  console.log(`\n  done ${done}, failed ${failed}`);
  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
