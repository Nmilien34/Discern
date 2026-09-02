// Seeds the seven stages.
//
//   npm run seed:stages -w @discern/backend
//
// ASSERTS EVERY ANCHOR RESOLVES TO A STORED PASSAGE before writing anything. A
// stage anchored to a reference that is not a stored pericope is invisible to
// retrieval — search returns stored passages, so an anchor that only parses is
// an anchor that can never actually be handed to anyone.
//
// Where a reference is valid but segmentation stored a different span (a curated
// boundary changed, or the anchor names verses inside a larger pericope), the
// STORED reference is substituted and the substitution is logged. Writing the
// requested-but-absent reference would be recording something retrieval cannot
// return.

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { logger } from "../lib/logger";
import { parseReference } from "../lib/reference";
import { PassageModel, StageModel } from "../models";
import { SHARED_ANCHORS, STAGE_SEEDS } from "./data/stages";

interface Resolution {
  requested: string;
  stored: string | null;
  substituted: boolean;
}

/** Exact stored passage, else the stored passage containing its first verse. */
async function resolveAnchor(reference: string): Promise<Resolution> {
  const parsed = parseReference(reference);

  const exact = await PassageModel.findOne({ reference: parsed.canonical })
    .select("reference")
    .lean();

  if (exact) {
    return { requested: reference, stored: exact.reference, substituted: false };
  }

  const startVerse = parsed.startVerse ?? 1;
  const containing = await PassageModel.findOne({
    bookSlug: parsed.book.slug,
    chapter: { $lte: parsed.startChapter },
    endChapter: { $gte: parsed.startChapter },
  })
    .where("chapter")
    .lte(parsed.startChapter)
    .sort({ chapter: -1, startVerse: -1 })
    .select("reference chapter startVerse endChapter endVerse")
    .lean();

  if (containing) {
    const startsBefore =
      containing.chapter < parsed.startChapter ||
      (containing.chapter === parsed.startChapter &&
        containing.startVerse <= startVerse);
    const endsAfter =
      containing.endChapter > parsed.startChapter ||
      (containing.endChapter === parsed.startChapter &&
        containing.endVerse >= startVerse);

    if (startsBefore && endsAfter) {
      return {
        requested: reference,
        stored: containing.reference,
        substituted: true,
      };
    }
  }

  return { requested: reference, stored: null, substituted: false };
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertCorpusWritable("seed-stages");

  const corpusSize = await PassageModel.estimatedDocumentCount();
  if (corpusSize === 0) {
    throw new Error(
      "No passages in the database. Stage anchors cannot be verified against an " +
        "empty corpus — run seed-corpus, ingest-bible and segment-passages first.",
    );
  }

  const failures: string[] = [];
  const substitutions: string[] = [];
  const resolved = new Map<string, string[]>();

  for (const stage of STAGE_SEEDS) {
    const anchors = [...SHARED_ANCHORS, ...stage.anchorPassages];
    const stored: string[] = [];

    for (const anchor of anchors) {
      const resolution = await resolveAnchor(anchor);

      if (!resolution.stored) {
        failures.push(`${stage.slug}: ${anchor}`);
        continue;
      }

      if (resolution.substituted) {
        substitutions.push(
          `${stage.slug}: ${resolution.requested} -> ${resolution.stored}`,
        );
      }

      if (!stored.includes(resolution.stored)) stored.push(resolution.stored);
    }

    resolved.set(stage.slug, stored);
  }

  if (substitutions.length > 0) {
    logger.warn(
      { count: substitutions.length },
      "anchors substituted to their stored pericope:\n  " +
        substitutions.join("\n  "),
    );
  }

  // Fail BEFORE writing. A partially seeded stage table with silently dropped
  // anchors is worse than no stages at all.
  if (failures.length > 0) {
    throw new Error(
      [
        "Stage anchors do not resolve to stored passages:",
        ...failures.map((f) => `  ${f}`),
        "",
        "  A stage anchored to a passage that does not exist as a stored unit is",
        "  invisible to retrieval. Either add the range to",
        "  scripts/data/pericopes.ts and re-run segmentation, or point the stage",
        "  at a passage that exists.",
      ].join("\n"),
    );
  }

  for (const stage of STAGE_SEEDS) {
    await StageModel.updateOne(
      { slug: stage.slug },
      {
        $set: {
          slug: stage.slug,
          order: stage.order,
          from: stage.from,
          to: stage.to,
          description: stage.description,
          anchorPassages: resolved.get(stage.slug) ?? [],
          openingQuestions: stage.openingQuestions,
        },
      },
      { upsert: true },
    );
  }

  logger.info(
    {
      stages: STAGE_SEEDS.length,
      anchorsVerified: [...resolved.values()].reduce((n, a) => n + a.length, 0),
      substituted: substitutions.length,
    },
    "stages seeded; every anchor resolves to a stored passage",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "stage seed failed",
    );
    process.exit(1);
  });
}
