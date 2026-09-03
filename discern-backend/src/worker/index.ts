// Worker process entry.
//
// PHASE 8. The idle loop is gone; this claims and runs jobs.
//
// Concurrency is N independent pollers rather than a batch fetch. Each claims
// one job with a single atomic findOneAndUpdate, runs it, and claims again —
// so a slow job blocks only its own poller, and a worker killed mid-job strands
// nothing: the lease expires and the next sweep picks it up.
//
// The loop never throws. A handler that fails is recorded and retried with
// backoff; a claim that fails is logged and slept past. A worker process that
// exits on a bad job is a worker that stops doing the other four.

import { env } from "../config/env";
import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { buildInfo } from "../lib/build-info";
import { logger } from "../lib/logger";
import "../models";
import { reportVectorIndexStatus } from "../services/corpus/retrieval";
import { HANDLERS, queueSnapshot, scheduleRecurring } from "../jobs/handlers";
import { claim, complete, fail, WORKER_ID } from "../jobs/queue";

let stopping = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** One poller: claim, run, repeat. `n` of these run concurrently. */
async function poller(index: number): Promise<void> {
  while (!stopping) {
    let job: Awaited<ReturnType<typeof claim>> = null;

    try {
      job = await claim();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : error, poller: index },
        "job claim failed",
      );
      await sleep(env.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(env.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    // Per-job correlation, per CONVENTIONS.md §logging — Corner's worker does
    // this and it is the difference between a readable log and a soup.
    const jobLog = logger.child({
      jobId: String(job._id),
      jobType: job.type,
      attempt: job.attempts,
    });

    const handler = HANDLERS[job.type];

    if (!handler) {
      // An unknown type is a deploy skew, not a transient fault. Fail it
      // permanently rather than retrying against code that does not exist.
      jobLog.error("no handler registered for this job type");
      await fail({ ...job, attempts: job.maxAttempts } as typeof job, new Error(
        `No handler for job type "${job.type}"`,
      ));
      continue;
    }

    const startedAt = Date.now();

    try {
      await handler(job);
      await complete(job);
      jobLog.info({ ms: Date.now() - startedAt }, "job done");
    } catch (error) {
      await fail(job, error);
    }
  }
}

/** Enqueues the recurring work. Idempotent, so running it often is free. */
async function scheduler(): Promise<void> {
  while (!stopping) {
    try {
      await scheduleRecurring();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : error },
        "recurring scheduling failed",
      );
    }
    await sleep(60_000);
  }
}

async function loop(): Promise<void> {
  const pollers = Array.from({ length: env.WORKER_CONCURRENCY }, (_unused, i) =>
    poller(i),
  );
  await Promise.all([...pollers, scheduler()]);
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
      leaseSeconds: env.WORKER_LEASE_SECONDS,
      handlers: Object.keys(HANDLERS),
      workerId: WORKER_ID,
      queue: await queueSnapshot(),
    },
    "discern worker started",
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
