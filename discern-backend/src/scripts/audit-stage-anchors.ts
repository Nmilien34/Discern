// Does the corpus actually contain, as RETRIEVABLE UNITS, what each stage needs?
//
//   npm run audit:stages -w @discern/backend
//
// Retrieval returns STORED passages. A passage that segmentation never produced
// cannot be embedded, cannot be offered as a carrying, and cannot be handed to
// anyone — so an anchor that only resolves as an ad-hoc range is not an anchor,
// it is a reference that happens to parse.
//
// For each candidate the audit reports one of:
//   EXACT     a stored passage with exactly this reference
//   CONTAINED the verses live inside a stored passage with different bounds —
//             usable, and often better, but the boundary is worth eyeballing
//   MISSING   not ingested at all

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { parseReference } from "../lib/reference";
import { PassageModel } from "../models";
import { STAGE_ANCHORS } from "./data/stage-anchors";

type Verdict = "EXACT" | "CONTAINED" | "MISSING";

interface AnchorResult {
  requested: string;
  verdict: Verdict;
  storedAs?: string;
}

async function checkAnchor(reference: string): Promise<AnchorResult> {
  const parsed = parseReference(reference);

  const exact = await PassageModel.findOne({ reference: parsed.canonical });
  if (exact) return { requested: reference, verdict: "EXACT" };

  // A passage whose span covers the requested start verse.
  const containing = await PassageModel.findOne({
    bookSlug: parsed.book.slug,
    $or: [
      {
        chapter: { $lte: parsed.startChapter },
        endChapter: { $gte: parsed.startChapter },
      },
    ],
  })
    .where("chapter")
    .lte(parsed.startChapter)
    .sort({ chapter: -1, startVerse: -1 });

  if (containing) {
    const startsBefore =
      containing.chapter < parsed.startChapter ||
      (containing.chapter === parsed.startChapter &&
        containing.startVerse <= (parsed.startVerse ?? 1));
    const endsAfter =
      containing.endChapter > parsed.startChapter ||
      (containing.endChapter === parsed.startChapter &&
        containing.endVerse >= (parsed.startVerse ?? 1));

    if (startsBefore && endsAfter) {
      return {
        requested: reference,
        verdict: "CONTAINED",
        storedAs: containing.reference,
      };
    }
  }

  return { requested: reference, verdict: "MISSING" };
}

async function main(): Promise<void> {
  await connectToDatabase();

  const rows: string[] = [];
  const summary: { stage: string; exact: number; contained: number; missing: number }[] =
    [];

  for (const stage of STAGE_ANCHORS) {
    rows.push("");
    rows.push(`${stage.from} → ${stage.to}   [${stage.slug}]`);

    let exact = 0;
    let contained = 0;
    let missing = 0;

    for (const anchor of stage.anchors) {
      const result = await checkAnchor(anchor);

      if (result.verdict === "EXACT") exact += 1;
      else if (result.verdict === "CONTAINED") contained += 1;
      else missing += 1;

      const note =
        result.verdict === "CONTAINED" ? `  (stored as ${result.storedAs})` : "";
      rows.push(`  ${result.verdict.padEnd(9)} ${result.requested}${note}`);
    }

    summary.push({ stage: stage.slug, exact, contained, missing });
  }

  console.log(rows.join("\n"));
  console.log("\n" + "=".repeat(66));
  console.log("SUMMARY — strong anchors are EXACT; CONTAINED still works\n");

  for (const row of summary) {
    // Fewer than three exact anchors is thin: Abigail must not hand the same
    // passage to the same person twice (ARCHITECTURE.md §6, passagesGiven), so a
    // stage needs several distinct units to draw on before it repeats itself.
    const thin = row.exact < 3;
    console.log(
      `  ${row.stage.padEnd(22)} exact ${String(row.exact).padStart(2)}  ` +
        `contained ${String(row.contained).padStart(2)}  ` +
        `missing ${String(row.missing).padStart(2)}` +
        (thin ? "   <-- THIN" : ""),
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
