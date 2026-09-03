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
import { PassageModel, SpeechCacheModel, StageModel, TranslationModel } from "../models";
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

  // Keyed by reference AND translation. Keyed by reference alone, this
  // reported WEB as "already cached" when what existed was a KJV recording.
  const already = new Set(
    (await SpeechCacheModel.find({ passageReference: { $ne: null } })
      .select("passageReference translationId")
      .lean()).map((r) => `${r.passageReference}::${r.translationId ?? "unknown"}`),
  );

  const defaultTranslation = await TranslationModel.findOne({ isDefault: true })
    .select("_id abbreviation")
    .lean();

  if (!defaultTranslation) {
    throw new Error("No default translation is set; refusing to guess one.");
  }

  const defaultTranslationId = String(defaultTranslation._id);
  console.log(`  translation: ${defaultTranslation.abbreviation} (default)`);

  let totalChars = 0;
  let counted = 0;
  const work: { reference: string; text: string }[] = [];

  for (const p of passages) {
    // on-request-only passages are never handed over unprompted, so they are
    // never read aloud unprompted either.
    if (p.handling === "on-request-only") continue;
    if (already.has(`${p.reference}::${defaultTranslationId}`)) continue;

    // THE DEFAULT TRANSLATION, RESOLVED — never "whichever came first".
    //
    // This took Object.values(texts)[0], and the stored key order puts KJV
    // before WEB, so the first full-corpus run synthesized 3,879 passages of
    // KJV: 1.94M credits of audio that no WEB reader will ever be served,
    // because the cache is keyed on the TEXT and the texts differ.
    //
    // "Yahweh is my light" and "The LORD is my light" are the same verse and a
    // different recording. Insertion order is not a translation choice.
    const texts = p.texts as unknown as Map<string, string> | Record<string, string>;
    const body =
      texts instanceof Map
        ? texts.get(defaultTranslationId)
        : texts?.[defaultTranslationId];

    const text = speakable(String(body ?? ""));
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
  let stopped = false;
  const failures: { reference: string; reason: string }[] = [];
  const startedAt = Date.now();

  // CONCURRENCY. Synthesis is ~4s of waiting on ElevenLabs and S3, so a
  // sequential run over 3,911 passages is about eight hours of mostly idling.
  // Eight at a time brings it under an hour without pushing the provider.
  const CONCURRENCY = 8;
  const queue = [...batch];

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const item = queue.shift();
      if (!item) return;

      const result = await synthesize(item.text, "pregen", {
        passageReference: item.reference,
        translationId: defaultTranslationId,
        // THE BULK LEDGER. A corpus run must never draw down the budget a
        // real listener's first play depends on.
        scope: "bulk",
      });

      if (!result || result.refusedReason) {
        failed += 1;
        failures.push({
          reference: item.reference,
          reason: result?.refusedReason ?? "no result",
        });
        // ONLY A DAILY CEILING STOPS THE RUN. A "per-request" refusal means
        // this one passage is too long and says nothing about the next — the
        // first version stopped on it and ended the corpus run at 952 of 3,879.
        if (
          result?.refusedLimit === "user-daily" ||
          result?.refusedLimit === "global-daily"
        ) {
          stopped = true;
          console.log(`    STOPPED at ${item.reference}: ${result.refusedReason}`);
        }
        continue;
      }

      done += 1;
      if (done % 100 === 0) {
        const rate = done / ((Date.now() - startedAt) / 1000);
        const left = Math.round((batch.length - done) / rate / 60);
        console.log(`    ${done}/${batch.length}  ${rate.toFixed(1)}/s  ~${left}m left`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n  done ${done}, failed ${failed}, in ${Math.round((Date.now()-startedAt)/60000)}m`);

  if (failures.length > 0) {
    console.log("\n  FAILURES:");
    const byReason = new Map<string, string[]>();
    for (const f of failures) {
      const list = byReason.get(f.reason) ?? [];
      list.push(f.reference);
      byReason.set(f.reason, list);
    }
    for (const [reason, refs] of byReason) {
      console.log(`    ${refs.length}x  ${reason}`);
      console.log(`         ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? " ..." : ""}`);
    }
  }
  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
