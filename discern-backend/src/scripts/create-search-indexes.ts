// Applies the committed Atlas Vector Search index definitions.
//
//   npm run atlas:index -w @discern/backend
//   npm run atlas:index -w @discern/backend -- --drop   # recreate from scratch
//
// The definitions in src/db/search-indexes/*.json are the source of truth. This
// script applies them through the driver so that "what is committed" and "what
// is deployed" can be reconciled by running one command, rather than by someone
// remembering what they typed into a dashboard.
//
// These are NOT Mongoose indexes and syncIndexes() does not build them — Atlas
// Search is a separate subsystem with its own API. Against a local mongod this
// fails, by design and unavoidably: the feature does not exist there.
//
// numDimensions in the JSON is checked against config/models.ts before anything
// is applied. Atlas does not validate vector width on write, so a mismatch is
// silent — queries return nothing, or return results scored in a space that does
// not match the data.

import { readFile } from "node:fs/promises";
import path from "node:path";

import mongoose from "mongoose";

import { embeddingDimensions, models } from "../config/models";
import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { logger } from "../lib/logger";
import "../models";

interface IndexFile {
  name: string;
  type: string;
  definition: {
    fields: { type: string; path: string; numDimensions?: number }[];
  };
}

const INDEX_FILES: { file: string; collection: string }[] = [
  { file: "passages.json", collection: "passages" },
  { file: "passages-enriched.json", collection: "passages" },
  { file: "hymns.json", collection: "hymns" },
];

async function main(): Promise<void> {
  const drop = process.argv.includes("--drop");
  const directory = path.resolve(__dirname, "../db/search-indexes");
  const expectedDimensions = embeddingDimensions();

  await connectToDatabase();
  const db = mongoose.connection.db;

  if (!db) throw new Error("No database handle after connecting.");

  for (const { file, collection } of INDEX_FILES) {
    const raw = await readFile(path.join(directory, file), "utf8");
    const definition = JSON.parse(raw) as IndexFile;

    // Check before applying, not after. An index built at the wrong width has to
    // be dropped and rebuilt, and the symptom that reveals it is "retrieval is
    // bad" rather than anything pointing at the index.
    const vectorField = definition.definition.fields.find(
      (field) => field.type === "vector",
    );

    if (vectorField?.numDimensions !== expectedDimensions) {
      throw new Error(
        [
          `${file} declares numDimensions ${vectorField?.numDimensions}, but the`,
          `configured embedding model (${models.embedding}) produces`,
          `${expectedDimensions}-dimension vectors.`,
          "",
          "Atlas does NOT validate vector width on write, so this mismatch would",
          "be silent. Fix the JSON (and re-run `npm run embed`) before applying.",
        ].join("\n"),
      );
    }

    const target = db.collection(collection);

    if (drop) {
      try {
        await target.dropSearchIndex(definition.name);
        logger.info({ index: definition.name }, "dropped existing index");
      } catch {
        // Not existing is the normal case on a first run.
      }
    }

    try {
      await target.createSearchIndex({
        name: definition.name,
        type: definition.type as "vectorSearch",
        definition: definition.definition,
      });
      logger.info(
        {
          index: definition.name,
          collection,
          dimensions: expectedDimensions,
        },
        "search index created — it builds asynchronously and is not queryable " +
          "until status is READY",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/already exists|IndexAlreadyExists/i.test(message)) {
        logger.info({ index: definition.name }, "index already exists");
        continue;
      }

      // A local mongod, or a tier without Atlas Search. Report it plainly rather
      // than letting a stack trace imply the definition is wrong.
      logger.error(
        { index: definition.name, reason: message.slice(0, 220) },
        "could not create search index",
      );
      throw error;
    }
  }

  // Report status so "it did not work" and "it is still building" are
  // distinguishable, which they otherwise are not.
  for (const { collection } of INDEX_FILES) {
    try {
      // The driver types listSearchIndexes() as { name } only; Atlas returns
      // status and queryable alongside it, and those are the fields that answer
      // "is it usable yet".
      const indexes = (await db
        .collection(collection)
        .listSearchIndexes()
        .toArray()) as unknown as {
        name: string;
        status?: string;
        queryable?: boolean;
      }[];

      for (const index of indexes) {
        logger.info(
          {
            collection,
            index: index.name,
            status: index.status ?? "unknown",
            queryable: index.queryable ?? false,
          },
          "search index status",
        );
      }
    } catch {
      logger.warn({ collection }, "could not list search indexes");
    }
  }

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "search index creation failed",
    );
    process.exit(1);
  });
}
