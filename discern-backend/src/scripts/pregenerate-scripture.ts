// PREGENERATE SCRIPTURE AUDIO. COSTS REAL MONEY — READ THE ESTIMATE FIRST.
//
//   npm run speech:pregen -w @discern/backend               # estimate only
//   npm run speech:pregen -w @discern/backend -- --run --limit 50
//
// Scripture is the case the cache was built for: every person handed Psalm 46
// hears the identical words, so paying per listener is paying for one file
// thousands of times.
//
// DEFAULTS TO A DRY RUN. The full corpus is 4,102 passages and the estimate
// below is not small; which subset is worth pregenerating is a spending
// decision, not a technical one, so this prints the number and stops unless
// told otherwise. Passages are ordered by stage anchors first — those are the
// ones she hands over most.

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { env } from "../config/env";
import { PassageModel, SpeechCacheModel } from "../models";
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

  // Stage anchors first: the passages she offers most, so a bounded budget
  // buys the most cache hits.
  const passages = await PassageModel.find({})
    .select("reference texts stageSlugs handling")
    .sort({ stageSlugs: -1 })
    .lean();

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
  console.log("SCRIPTURE PREGENERATION");
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
    console.log("  the first listener a faster start.");
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
