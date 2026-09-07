// Seeds authored cultivation reads.
//
//   npx tsx src/scripts/seed-cultivation.ts                 dry run, writes nothing
//   npx tsx src/scripts/seed-cultivation.ts --apply         write, NOT published
//   npx tsx src/scripts/seed-cultivation.ts --apply --publish
//
// DRY RUN IS THE DEFAULT, and --publish is separate from --apply, because those
// are two different decisions. Writing a read is safe. PUBLISHING ONE IS NOT:
//
//   availability.service.ts:69   available: readCount > 0
//
// One published read makes the whole virtue available — onboarding screen 7
// starts offering it, and the paywall names its first read — while eight of the
// nine are unwritten. That is the exact failure availability-from-the-database
// was built to prevent, one level down: instead of promising a virtue that does
// not exist, it promises a path that is one ninth built. So publishing is its
// own flag and its own moment.
//
// EVERY CITATION IS RESOLVED BEFORE ANYTHING IS WRITTEN. The corpus is
// segmented into pericopes, so "Proverbs 21:2" renders but comes back with
// id: null — not carryable, no audio. EVERY stored pericope the citation
// touches is recorded, never substituted for the citation itself, because the
// read prints 21:2 and means 21:2. Same problem seed-stages.ts has with
// anchors, one degree harder: a read's citation is the unit that makes an
// argument, and the segmenter cut on narrative seams, so the two straddle.
//
// And every passage marker in the body must resolve, or the read is refused: a
// marker that does not match leaves a bare reference sitting in the prose where
// a set-apart quote should be.

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { assertWritable } from "../lib/production-guard";
import { parseReference } from "../lib/reference";
import { PassageModel } from "../models";
import { CultivationReadModel } from "../models/cultivation-read.model";
import type { CultivationReadPassage } from "../models/cultivation-read.model";
import type { AuthoredRead } from "./data/cultivation/pride-humility";
import { PRIDE_HUMILITY_READS } from "./data/cultivation/pride-humility";
import type { StageSlug } from "@discern/shared";

const PATHS: { stageSlug: StageSlug; reads: AuthoredRead[] }[] = [
  { stageSlug: "pride-humility", reads: PRIDE_HUMILITY_READS },
];

const apply = process.argv.includes("--apply");
const publish = process.argv.includes("--publish");

/**
 * The citation, plus every stored pericope it touches, in verse order.
 *
 * A citation that touches NOTHING is an error and stops the seed: it would
 * render as text and then be uncarryable and silent.
 */
async function resolvePassage(reference: string): Promise<CultivationReadPassage> {
  const parsed = parseReference(reference);

  // NO EARLY RETURN FOR AN EXACT MATCH. A citation that IS a stored pericope
  // still records itself in `storedReferences` — the field means "what can be
  // carried", and an empty array for the one case that carries perfectly would
  // be a trap for every consumer.
  const startVerse = parsed.startVerse ?? 1;
  const endVerse = parsed.endVerse ?? startVerse;

  // EVERY stored passage the citation touches, not just the first.
  //
  // A citation can straddle a pericope boundary — Matthew 26:69-75 is stored as
  // 26:69-71 and 26:72-75 — and recording only the one containing the first
  // verse would hand a reader who carries it two thirds of what the read
  // quoted, silently. Found on read 5, which is exactly that case.
  const overlapping = await PassageModel.find({
    bookSlug: parsed.book.slug,
    chapter: parsed.startChapter,
    startVerse: { $lte: endVerse },
    endVerse: { $gte: startVerse },
  })
    .select("reference startVerse")
    .sort({ startVerse: 1 })
    .lean();

  if (overlapping.length === 0) {
    throw new Error(
      `${parsed.canonical} is in no stored passage. It would render as text and ` +
        "then be uncarryable and silent, which is a dead end at the one moment " +
        "the read is asking someone to sit with it.",
    );
  }

  if (overlapping.length > 1) {
    logger.info(
      {
        cited: parsed.canonical,
        spans: overlapping.map((p) => p.reference),
      },
      "citation straddles a pericope boundary — recording all of them",
    );
  }

  return {
    reference: parsed.canonical,
    storedReferences: overlapping.map((p) => p.reference),
    runtimeSeconds: null,
  };
}

async function main(): Promise<void> {
  // GUARDED ONLY WHEN IT ACTUALLY WRITES. A dry run performs no write, and
  // refusing to dry-run against production would push people to skip the dry
  // run — which is the opposite of what the guard is for. With --apply it
  // refuses `discern` without --i-know-this-is-production, and this script can
  // also flip a virtue live, so it is exactly the kind the guard exists for.
  if (apply) assertWritable("seed-cultivation.ts");

  await connectToDatabase();
  assertCorpusWritable("seed-cultivation.ts");

  let written = 0;
  let refused = 0;

  for (const { stageSlug, reads } of PATHS) {
    for (const read of reads) {
      const label = `${stageSlug} read ${read.order} — "${read.title}"`;

      let passages: CultivationReadPassage[];
      try {
        passages = await Promise.all(read.passages.map(resolvePassage));
      } catch (error) {
        logger.error({ read: label, err: (error as Error).message }, "citation refused");
        refused += 1;
        continue;
      }

      // Every body paragraph that looks like a bare citation must be one we
      // resolved, or the reader gets a reference where a quote belongs.
      const cited = new Set(passages.map((p) => p.reference));
      const orphaned = read.body.filter(
        (line) => /^[1-3]?\s*[A-Z][A-Za-z ]+ \d+:\d+(-\d+)?$/.test(line.trim()) && !cited.has(line.trim()),
      );
      if (orphaned.length > 0) {
        logger.error({ read: label, orphaned }, "body marks a passage that is not in `passages`");
        refused += 1;
        continue;
      }


      if (!apply) {
        logger.info(
          {
            read: label,
            type: read.type,
            runtimeSeconds: read.runtimeSeconds,
            paragraphs: read.body.length,
            words: read.body.reduce((n, p) => n + p.split(/\s+/).length, 0),
            passages: passages.map(
              (p) => `${p.reference} -> [${p.storedReferences.join(", ")}]`,
            ),
            action: read.action,
            wouldPublish: publish,
          },
          "DRY RUN — would write",
        );
        continue;
      }

      await CultivationReadModel.updateOne(
        { stageSlug, order: read.order },
        {
          $set: {
            stageSlug,
            order: read.order,
            type: read.type,
            title: read.title,
            runtimeSeconds: read.runtimeSeconds,
            header: read.header,
            body: read.body,
            passages,
            action: read.action,
            // Never unpublishes on a re-run: $set only when publishing, so
            // re-seeding a live read to fix a typo does not take it down.
            ...(publish ? { publishedAt: new Date() } : {}),
          },
          $setOnInsert: publish ? {} : { publishedAt: null },
        },
        { upsert: true },
      );
      written += 1;
      logger.info({ read: label, published: publish }, "written");
    }
  }

  const live = await CultivationReadModel.countDocuments({
    stageSlug: "pride-humility",
    publishedAt: { $ne: null, $lte: new Date() },
  });

  logger.info(
    {
      written,
      refused,
      applied: apply,
      humilityPublishedReads: live,
      humilityAvailable: live > 0,
    },
    live > 0 && live < 9
      ? "HUMILITY IS NOW AVAILABLE with fewer than nine reads — onboarding will offer it"
      : "done",
  );

  await disconnectFromDatabase();
  if (refused > 0) process.exit(1);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "seed-cultivation failed");
  process.exit(1);
});
