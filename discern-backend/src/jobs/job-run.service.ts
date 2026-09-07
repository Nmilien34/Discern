// Recording what a job run actually did.
//
// The handler reports its own result through the `report` callback. A handler
// that never calls it still gets a run recorded, with an empty result, because
// a job that finished and told us nothing is itself a fact worth having — and
// making the call mandatory would mean one forgotten line silently loses the
// whole run.

import type { JobType, JobRunOutcome } from "@discern/shared";
import type { Types } from "mongoose";

import { logger } from "../lib/logger";
import { JobRunModel } from "../models";

export interface JobReport {
  /** What this run did. The shape is the job's own business. */
  result: Record<string, unknown>;
  /**
   * Ran correctly and deliberately did no work — nothing was due, nothing was
   * uncached, the feature is off. Distinct from success, because a dashboard
   * showing 821 green sweeps that enqueued nothing is not telling the truth
   * about your notifications.
   */
  skipped?: boolean;
}

/** Handed to every handler. Optional to call; calling twice replaces. */
export type Reporter = (report: JobReport) => void;

export async function recordRun(input: {
  job: JobType;
  startedAt: Date;
  finishedAt: Date;
  outcome: JobRunOutcome;
  result: Record<string, unknown>;
  error?: unknown;
  jobId?: Types.ObjectId | null;
}): Promise<void> {
  const error =
    input.error === undefined || input.error === null
      ? null
      : input.error instanceof Error
        ? input.error.message
        : String(input.error);

  try {
    await JobRunModel.create({
      job: input.job,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
      outcome: input.outcome,
      result: input.result,
      error,
      jobId: input.jobId ?? null,
    });
  } catch (cause) {
    // NEVER let bookkeeping fail a job. The run already happened. Losing the
    // record of it is bad; turning a successful job into a failed one because a
    // diagnostic row would not write is worse.
    logger.error(
      { job: input.job, err: cause instanceof Error ? cause.message : cause },
      "could not record job run",
    );
  }
}
