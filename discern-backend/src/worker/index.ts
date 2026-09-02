// Worker process entry.
//
// PHASE 1 STUB, DELIBERATELY. render.yaml declares discern-worker as a real
// Render service, and a declared service with no entry point crash-loops on
// deploy — so this exists to make the manifest honest, not because the worker
// does anything yet.
//
// It boots, asserts the same database as the API, reports the same build
// identity, and idles. Phase 8 replaces the idle loop with the Mongo-backed job
// queue: atomic lease claim via one findOneAndUpdate, expired-lease reaping,
// exponential backoff, and the handler registry (embedding backfill, TTS
// pregeneration, notification scheduling, nightly conversation summaries).

import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { buildInfo } from "../lib/build-info";
import { logger } from "../lib/logger";
import "../models";
import { reportVectorIndexStatus } from "../services/corpus/retrieval";

let stopping = false;

async function loop(): Promise<void> {
  while (!stopping) {
    // Phase 8: claim and run jobs here.
    await new Promise((resolve) =>
      setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS),
    );
  }
}

export async function startWorker(): Promise<void> {
  await connectToDatabase();

  // WARN, do not crash. The reader, author navigation, journey and carryings all
  // work without a vector index; only retrieval does. Refusing to boot over it
  // would take down the free half of the product to protect the paid half.
  await reportVectorIndexStatus();

  // Same identity the API reports at /healthz, so the two can be compared
  // directly. They build from one commit but deploy independently.
  //
  // No `service` in the payload: the logger's base field already carries it,
  // resolved from RENDER_SERVICE_NAME or SERVICE_NAME. Passing it here would
  // emit the key twice — pino appends, it does not merge.
  const build = buildInfo("discern-worker");

  logger.info(
    {
      commit: build.commitShort,
      startedAt: build.startedAt,
      nodeEnv: build.nodeEnv,
      concurrency: env.WORKER_CONCURRENCY,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      handlers: 0,
    },
    "discern worker started (phase 1 stub: no handlers registered)",
  );

  await loop();
}

async function main(): Promise<void> {
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "worker shutting down");
    stopping = true;
    setTimeout(() => {
      void disconnectFromDatabase().finally(() => process.exit(0));
    }, 1_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await startWorker();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, "fatal worker error");
    process.exit(1);
  });
}
