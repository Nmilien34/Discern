import mongoose from "mongoose";

import { env } from "../config/env";
import { logger } from "../lib/logger";

/**
 * Connects, then refuses to continue if the URI resolved to the wrong database.
 *
 * ARCHITECTURE.md §4 puts the `discern` database on the EXISTING Atlas cluster,
 * which is exactly the situation this assertion exists for. Two ordinary
 * mistakes put Discern's collections somewhere they must never appear, and
 * neither one produces an error on its own:
 *
 *   mongodb+srv://.../?retryWrites=true      -> connects to `test`
 *   mongodb+srv://.../corner?...             -> connects to the neighbour's db
 *
 * Both log "mongo connected" and serve traffic happily. The damage is only
 * visible later, in the wrong collection, on a cluster with real users on it.
 * Failing at boot is recoverable; discovering it afterwards may not be.
 */
export async function connectToDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    serverSelectionTimeoutMS: 10_000,
  });

  const actual = mongoose.connection.name;

  if (actual !== env.MONGODB_DB_NAME) {
    await mongoose.disconnect();
    throw new Error(
      [
        "Refusing to start: connected to the wrong database.",
        "",
        `  expected: ${env.MONGODB_DB_NAME}`,
        `  actual:   ${actual}`,
        "",
        actual === "test"
          ? "  `test` means MONGODB_URI has no database path. Add it:\n" +
            "      mongodb+srv://user:pass@host/" +
            env.MONGODB_DB_NAME +
            "?retryWrites=true&w=majority"
          : "  MONGODB_URI points at another application's database. Discern\n" +
            "  shares a cluster; writing here would put Discern's collections\n" +
            "  inside it.",
      ].join("\n"),
    );
  }

  logger.info(
    { database: actual, maxPoolSize: env.MONGODB_MAX_POOL_SIZE },
    "mongo connected",
  );
}

/**
 * Databases the corpus scripts are allowed to write to.
 *
 * `discern` plus any `discern-*` variant, so scratch databases used for
 * verification still work.
 */
const CORPUS_DATABASE_PATTERN = /^discern(-[a-z0-9-]+)?$/;

/**
 * Refuses to let a corpus-WRITING script run against a database that is not
 * Discern's.
 *
 * connectToDatabase() already asserts that the URI resolved to MONGODB_DB_NAME —
 * but that check is satisfied by ANY consistent pair. Point MONGODB_URI at
 * another application's cluster and set MONGODB_DB_NAME to that application's
 * database, and the assertion passes while every write lands in their data.
 *
 * That is not hypothetical. Discern shares a cluster (ARCHITECTURE.md §4), the
 * sibling apps use the same `.env` layout, and a `.env` copied from one of them
 * is both the obvious way to get started and completely silent about what it is
 * pointed at. The ingest, segment and embed scripts each write tens of thousands
 * of documents; there is no recovering from doing that to a live database by
 * hand.
 *
 * The API deliberately does NOT call this — reading is not the dangerous
 * direction, and a flexible database name is useful there.
 */
export function assertCorpusWritable(script: string): void {
  const actual = mongoose.connection.name;

  if (!CORPUS_DATABASE_PATTERN.test(actual)) {
    throw new Error(
      [
        `Refusing to run "${script}": this is not a Discern database.`,
        "",
        `  connected to: ${actual}`,
        "  expected:     discern (or discern-<suffix> for a scratch database)",
        "",
        "  This script WRITES the corpus. A .env copied from a sibling app",
        "  (Corner, Leanient, Pepta) points MONGODB_URI and MONGODB_DB_NAME at",
        "  THAT app's database, and the boot-time name check cannot tell the",
        "  difference because the pair is internally consistent.",
        "",
        "  Set MONGODB_URI and MONGODB_DB_NAME to Discern's own database.",
      ].join("\n"),
    );
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info("mongo disconnected");
}

/** Backs `GET /healthz`. 1 is mongoose's "connected" readyState. */
export function isDatabaseReachable(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Builds every index declared on a registered model.
 *
 * Mongoose's `autoIndex` does this implicitly on first use, which is fine in
 * development and unhelpful in production: it happens lazily, per model, on
 * whichever request first touches the collection. Calling it at boot makes index
 * creation a startup concern with a log line rather than a slow first request.
 *
 * NOTE for Phase 3: Atlas VECTOR SEARCH indexes are NOT Mongoose indexes and are
 * not created here. They are applied through the Atlas API from the JSON
 * committed under src/db/search-indexes/, and their absence must warn rather
 * than crash — most of Discern works without them; only retrieval does.
 */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);

  if (names.length === 0) {
    logger.info("no models registered, skipping index sync");
    return;
  }

  for (const name of names) {
    await mongoose.models[name]?.createIndexes();
  }

  logger.info({ models: names.length }, "indexes synced");
}
