// ONE DOCUMENT PER EXECUTION. Not per job, per run.
//
// WHY THIS EXISTS. The `jobs` collection is a queue: a row is work to be done,
// and it is mutated in place as it moves through queued → running → done. That
// makes it a poor record of what happened. A recurring job keyed by day leaves
// one row per day whatever it did, a job that has never been enqueued leaves no
// row at all, and "done" says the handler returned — not that it accomplished
// anything.
//
// On 2026-09-06 that gap cost four days: `discern-worker` had been live since
// 09-03 and nothing in the system could say whether its jobs were running.
// Meanwhile `notification-schedule` had swept 821 times and enqueued zero
// sends, and `tts-pregenerate` had completed twice while synthesizing nothing.
// Both were green. Neither was doing anything.
//
// So a run records what it DID, not that it finished:
//   - `result` is a small payload each job defines for itself
//   - `outcome: "skipped"` is a first-class answer, distinct from success,
//     because "ran and correctly did nothing" and "ran and did the work" must
//     not look the same on a dashboard
//
// CAPPED BY TTL. This is diagnostic exhaust, not a ledger. Thirty days is long
// enough to answer "when did this last work" and short enough that a job
// running every five minutes cannot grow unbounded.

import { JOB_TYPES, JOB_RUN_OUTCOMES } from "@discern/shared";
import type { JobType, JobRunOutcome } from "@discern/shared";
import { Schema, model } from "mongoose";
import type { Document, Model, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface JobRunDocument extends Document<Types.ObjectId> {
  job: JobType;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  outcome: JobRunOutcome;
  /** Whatever the job decided is worth knowing. Shape is per job, by design. */
  result: Record<string, unknown>;
  /** Set only when outcome is "failure". */
  error: string | null;
  /** The queue row this run came from, when there was one. */
  jobId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobRunSchema = new Schema<JobRunDocument>(
  {
    job: { type: String, enum: JOB_TYPES, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true, min: 0 },
    outcome: { type: String, enum: JOB_RUN_OUTCOMES, required: true },
    result: { type: Schema.Types.Mixed, required: true, default: {} },
    error: { type: String, default: null },
    jobId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false },
);

// The only query this collection serves: newest run for a job, and newest
// SUCCESSFUL run for a job. Both are covered by this one index.
jobRunSchema.index({ job: 1, finishedAt: -1 });
jobRunSchema.index({ job: 1, outcome: 1, finishedAt: -1 });

// Diagnostic exhaust, not a ledger.
jobRunSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

applyApiTransforms(jobRunSchema);

export const JobRunModel: Model<JobRunDocument> = model<JobRunDocument>(
  "JobRun",
  jobRunSchema,
);
