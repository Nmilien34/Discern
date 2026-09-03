// THE JOB QUEUE. Mongo-backed, because the cluster is already there and a
// second piece of infrastructure for four jobs a night is not worth its own
// failure mode.
//
// Three properties carry the whole design:
//
// IDEMPOTENCY. Every job has an `idempotencyKey` that names what it is FOR,
// not when it was made — "summarize:<userId>:2026-09-03", not a uuid. A unique
// index on it means enqueueing the same work twice is a no-op rather than a
// duplicate, so a scheduler that runs twice, or a deploy mid-sweep, cannot send
// one person two notifications about the same carrying.
//
// LEASES, NOT LOCKS. A claim sets `leasedUntil` in the future and a worker that
// dies simply stops renewing. The next sweep finds the lease expired and takes
// the job. There is no lock to get stuck and nothing to release by hand.
//
// BACKOFF WITH A CEILING ON ATTEMPTS. A job that fails forever is a job that
// fails loudly once and then stops: `failed` is terminal and keeps its error,
// because a queue that retries a poisoned job until the end of time is how a
// worker looks healthy while doing nothing.

import { Schema, model } from "mongoose";
import type { Document, Model, Types } from "mongoose";

export const JOB_TYPES = [
  "embedding-backfill",
  "tts-pregenerate",
  "memory-summarize",
  "notification-schedule",
  "notification-send",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobDocument extends Document<Types.ObjectId> {
  type: JobType;
  status: JobStatus;
  /** Names the WORK, not the moment. Unique, so re-enqueueing is a no-op. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
  /** Not claimable before this. How "at 8pm in their timezone" is expressed. */
  runAfter: Date;
  attempts: number;
  maxAttempts: number;
  /** Held by a worker until this instant. Past it, the job is claimable again. */
  leasedUntil: Date | null;
  leasedBy: string | null;
  lastError: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDocument>(
  {
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, required: true, default: "queued" },
    idempotencyKey: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true, default: {} },
    runAfter: { type: Date, required: true, default: () => new Date() },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true, default: 5 },
    leasedUntil: { type: Date, default: null },
    leasedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// THE IDEMPOTENCY GUARANTEE. Everything else is convention; this is enforced.
jobSchema.index({ idempotencyKey: 1 }, { unique: true });

// The claim query, in index order: what is runnable, oldest first.
jobSchema.index({ status: 1, runAfter: 1, leasedUntil: 1 });

// Finished jobs are evidence for a fortnight, then noise.
jobSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 14 * 24 * 60 * 60, partialFilterExpression: { status: "done" } },
);

export const JobModel: Model<JobDocument> = model<JobDocument>("Job", jobSchema);
