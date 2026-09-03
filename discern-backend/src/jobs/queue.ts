// ENQUEUE AND CLAIM.
//
// The claim is ONE `findOneAndUpdate`. That is the entire concurrency design:
// the query says "queued or lease expired, and due", the update stamps a new
// lease, and Mongo applies it atomically to exactly one document. Two workers
// racing for the same job means one gets it and the other's query matches the
// next one. No transactions, no advisory locks, nothing to leave behind when a
// process is killed mid-job.

import crypto from "node:crypto";

import { env } from "../config/env";
import { logger } from "../lib/logger";
import { JobModel } from "../models";
import type { JobDocument, JobType } from "../models";

/** Identifies this process in a lease, so a stuck job names its holder. */
export const WORKER_ID = `${process.env.RENDER_INSTANCE_ID ?? "local"}-${crypto.randomBytes(4).toString("hex")}`;

export interface EnqueueOptions {
  type: JobType;
  /**
   * Names the WORK. "summarize:<userId>:2026-09-03", never a uuid.
   *
   * This is what makes a scheduler safe to run twice, and it is why a person
   * cannot receive two notifications about the same carrying on the same day.
   */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Returns the job, or null when this work was already queued. */
export async function enqueue(options: EnqueueOptions): Promise<JobDocument | null> {
  try {
    return await JobModel.create({
      type: options.type,
      idempotencyKey: options.idempotencyKey,
      payload: options.payload ?? {},
      runAfter: options.runAfter ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
    });
  } catch (error) {
    // Duplicate key is the feature working, not a failure.
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
}

/**
 * Claim one runnable job, or null.
 *
 * Matches `queued` jobs that are due, AND `running` jobs whose lease has
 * expired — which is how a job survives its worker being killed. The lease is
 * long enough for the slowest handler and short enough that a crash does not
 * strand work for an hour.
 */
export async function claim(): Promise<JobDocument | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + env.WORKER_LEASE_SECONDS * 1000);

  return JobModel.findOneAndUpdate(
    {
      runAfter: { $lte: now },
      $or: [
        { status: "queued" },
        // Reaped: a worker took this and never finished.
        { status: "running", leasedUntil: { $lt: now } },
      ],
    },
    {
      $set: { status: "running", leasedUntil: leaseUntil, leasedBy: WORKER_ID },
      $inc: { attempts: 1 },
    },
    { sort: { runAfter: 1 }, new: true },
  );
}

export async function complete(job: JobDocument): Promise<void> {
  await JobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: "done",
        completedAt: new Date(),
        leasedUntil: null,
        leasedBy: null,
        lastError: null,
      },
    },
  );
}

/**
 * Record a failure and decide whether it gets another go.
 *
 * Exponential backoff with a cap, and `failed` is TERMINAL. A job that has
 * burned its attempts stops and keeps its error, because a queue that retries a
 * poisoned job forever is a worker that looks busy and achieves nothing.
 */
export async function fail(job: JobDocument, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    logger.error(
      { jobId: String(job._id), type: job.type, attempts: job.attempts, err: message },
      "job FAILED permanently — it will not be retried",
    );

    await JobModel.updateOne(
      { _id: job._id },
      { $set: { status: "failed", lastError: message, leasedUntil: null, leasedBy: null } },
    );
    return;
  }

  // 30s, 60s, 2m, 4m... capped at 15 minutes.
  const backoffMs = Math.min(30_000 * 2 ** (job.attempts - 1), 15 * 60_000);

  logger.warn(
    { jobId: String(job._id), type: job.type, attempt: job.attempts, retryInMs: backoffMs, err: message },
    "job failed; will retry",
  );

  await JobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: "queued",
        lastError: message,
        leasedUntil: null,
        leasedBy: null,
        runAfter: new Date(Date.now() + backoffMs),
      },
    },
  );
}
