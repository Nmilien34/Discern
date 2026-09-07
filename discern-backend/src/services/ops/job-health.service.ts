// Job health, built from a HARDCODED list rather than from what happens to be
// in the collection.
//
// This is the whole point of the endpoint. A job that has never executed leaves
// no rows, and if the response were built by grouping over `jobRuns` that job
// would simply be absent — indistinguishable from a query that missed it. On
// 2026-09-06 `embedding-backfill` had never run once and nothing anywhere said
// so; it was invisible rather than reported. So the list of jobs comes from
// JOB_TYPES, and a job with no runs comes back as a present row saying
// `never-run`.

import { JOB_TYPES } from "@discern/shared";
import type { JobHealth, JobHealthResponse, JobRun } from "@discern/shared";

import { JobRunModel } from "../../models";
import type { JobRunDocument } from "../../models";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after its last run a job is considered idle rather than ok. Applied
 * only to jobs that HAVE run: a job with no schedule is not late, it is simply
 * not scheduled, and this is a coarse "should have heard from it by now" rather
 * than a per-job cron expectation.
 */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function toRun(doc: JobRunDocument): JobRun {
  return {
    job: doc.job,
    startedAt: doc.startedAt.toISOString(),
    finishedAt: doc.finishedAt.toISOString(),
    durationMs: doc.durationMs,
    outcome: doc.outcome,
    result: (doc.result ?? {}) as Record<string, unknown>,
    error: doc.error,
  };
}

export async function jobHealth(): Promise<JobHealthResponse> {
  const since = new Date(Date.now() - DAY_MS);
  const now = Date.now();

  const jobs: JobHealth[] = await Promise.all(
    JOB_TYPES.map(async (job): Promise<JobHealth> => {
      const [lastDoc, lastSuccessDoc, runsLast24h, failuresLast24h] = await Promise.all([
        JobRunModel.findOne({ job }).sort({ finishedAt: -1 }),
        JobRunModel.findOne({ job, outcome: { $in: ["success", "skipped"] } }).sort({
          finishedAt: -1,
        }),
        JobRunModel.countDocuments({ job, finishedAt: { $gte: since } }),
        JobRunModel.countDocuments({
          job,
          outcome: "failure",
          finishedAt: { $gte: since },
        }),
      ]);

      const lastRun = lastDoc ? toRun(lastDoc) : null;

      // NEVER-RUN IS A STATE, NOT AN ABSENCE.
      const state: JobHealth["state"] =
        lastDoc === null
          ? "never-run"
          : lastDoc.outcome === "failure"
            ? "failing"
            : now - lastDoc.finishedAt.getTime() > STALE_AFTER_MS
              ? "idle"
              : "ok";

      return {
        job,
        state,
        lastRun,
        lastSuccess: lastSuccessDoc ? toRun(lastSuccessDoc) : null,
        runsLast24h,
        failuresLast24h,
      };
    }),
  );

  return { jobs, checkedAt: new Date().toISOString() };
}
