// Job health. One row per job type that is SUPPOSED to exist, whether or not it
// has ever run.
//
// THE POINT OF THIS CONTRACT IS THE `never-run` CASE. A job that has never
// executed is absent from any table keyed on its own executions, and absence is
// indistinguishable from "the query missed it". That is exactly how
// `embedding-backfill` went four days without anyone noticing it had never
// started, and how the worker's existence went unanswered for the same four
// days. So the response is built from a hardcoded list of job types and a job
// with no runs comes back as a present row saying `never-run`, never as a
// missing key.

import { z } from "zod";

import { JOB_TYPES } from "../constants";

export const JOB_RUN_OUTCOMES = ["success", "failure", "skipped"] as const;
export const jobRunOutcomeSchema = z.enum(JOB_RUN_OUTCOMES);
export type JobRunOutcome = z.infer<typeof jobRunOutcomeSchema>;

export const jobRunSchema = z
  .object({
    job: z.enum(JOB_TYPES),
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    outcome: jobRunOutcomeSchema,
    /**
     * Each job defines its own. Deliberately loose: the shape of "what it did"
     * differs per job and forcing one schema would either be empty or a union
     * that has to change every time a job learns to report something new.
     */
    result: z.record(z.string(), z.unknown()),
    error: z.string().nullable(),
  })
  .strict();
export type JobRun = z.infer<typeof jobRunSchema>;

/**
 * `lastRun` is null when the job has never executed. `lastSuccess` is tracked
 * separately because "ran an hour ago" and "last did something useful an hour
 * ago" are different questions, and a job that has been failing on loop answers
 * the first one reassuringly.
 */
export const jobHealthSchema = z
  .object({
    job: z.enum(JOB_TYPES),
    state: z.enum(["never-run", "ok", "failing", "idle"]),
    lastRun: jobRunSchema.nullable(),
    lastSuccess: jobRunSchema.nullable(),
    runsLast24h: z.number().int().nonnegative(),
    failuresLast24h: z.number().int().nonnegative(),
  })
  .strict();
export type JobHealth = z.infer<typeof jobHealthSchema>;

export const jobHealthResponseSchema = z
  .object({
    /** One entry per JOB_TYPES, always, in JOB_TYPES order. */
    jobs: z.array(jobHealthSchema),
    checkedAt: z.string(),
  })
  .strict();
export type JobHealthResponse = z.infer<typeof jobHealthResponseSchema>;
