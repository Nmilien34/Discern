// The never-run case, which is the entire reason this endpoint exists.
//
// On 2026-09-06 `embedding-backfill` had never executed once and nothing in the
// system said so — it was absent from every table keyed on its own executions,
// and absence is indistinguishable from a query that missed it. That is also
// how "has discern-worker ever run its jobs" went four days without an answer.
//
// So the assertion that matters is not "a run is recorded". It is: a job with
// ZERO rows still comes back, as a present row saying never-run.
//
// Runs against local mongod (setup-env points at discern-test). Skips rather
// than fails when mongod is unreachable — this is an integration test and its
// absence is not a broken build.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JOB_TYPES, jobHealthResponseSchema } from "@discern/shared";

import { JobRunModel } from "../models";
import { recordRun } from "../jobs/job-run.service";
import { jobHealth } from "../services/ops/job-health.service";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: process.env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 1500,
    });
    connected = true;
  } catch {
    connected = false;
  }
});

afterAll(async () => {
  if (connected) {
    await JobRunModel.deleteMany({});
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (connected) await JobRunModel.deleteMany({});
});

describe("job health", () => {
  it("reports EVERY job type even when the collection is empty", async ({ skip }) => {
    if (!connected) skip();

    const health = await jobHealth();

    // Parsed against the shared contract, not just eyeballed.
    expect(() => jobHealthResponseSchema.parse(health)).not.toThrow();
    expect(health.jobs).toHaveLength(JOB_TYPES.length);
    expect(health.jobs.map((j) => j.job)).toEqual([...JOB_TYPES]);
    for (const j of health.jobs) {
      expect(j.state).toBe("never-run");
      expect(j.lastRun).toBeNull();
      expect(j.lastSuccess).toBeNull();
    }
  });

  it("a job that has never run stays present when OTHER jobs have run", async ({ skip }) => {
    if (!connected) skip();

    // The real 2026-09-06 shape: four jobs with history, one with none.
    await recordRun({
      job: "notification-schedule",
      startedAt: new Date(Date.now() - 1000),
      finishedAt: new Date(),
      outcome: "skipped",
      result: { considered: 0, scheduled: 0 },
    });

    const health = await jobHealth();
    const backfill = health.jobs.find((j) => j.job === "embedding-backfill");

    expect(backfill).toBeDefined();
    expect(backfill!.state).toBe("never-run");
    expect(health.jobs).toHaveLength(JOB_TYPES.length);
  });

  it("distinguishes SKIPPED from success, because green-but-idle is the bug", async ({
    skip,
  }) => {
    if (!connected) skip();

    await recordRun({
      job: "notification-schedule",
      startedAt: new Date(Date.now() - 500),
      finishedAt: new Date(),
      outcome: "skipped",
      result: { considered: 0, scheduled: 0 },
    });

    const sweep = (await jobHealth()).jobs.find((j) => j.job === "notification-schedule")!;

    expect(sweep.state).toBe("ok");
    expect(sweep.lastRun!.outcome).toBe("skipped");
    // A skipped run still counts as the last thing that worked — it did not
    // fail — so lastSuccess is set, and the outcome is what tells you it did
    // nothing.
    expect(sweep.lastSuccess!.outcome).toBe("skipped");
    expect(sweep.lastRun!.result).toEqual({ considered: 0, scheduled: 0 });
  });

  it("reports failing when the newest run failed, and keeps the last good one", async ({
    skip,
  }) => {
    if (!connected) skip();

    await recordRun({
      job: "tts-pregenerate",
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(Date.now() - 59_000),
      outcome: "success",
      result: { synthesized: 4 },
    });
    await recordRun({
      job: "tts-pregenerate",
      startedAt: new Date(Date.now() - 1000),
      finishedAt: new Date(),
      outcome: "failure",
      result: {},
      error: new Error("VOICE_ENABLED is false"),
    });

    const tts = (await jobHealth()).jobs.find((j) => j.job === "tts-pregenerate")!;

    expect(tts.state).toBe("failing");
    expect(tts.lastRun!.error).toBe("VOICE_ENABLED is false");
    expect(tts.lastSuccess!.result).toEqual({ synthesized: 4 });
    expect(tts.failuresLast24h).toBe(1);
    expect(tts.runsLast24h).toBe(2);
  });

  it("never throws a job's bookkeeping into the job's own result", async ({ skip }) => {
    if (!connected) skip();

    // A recordRun that cannot write must not throw — the run already happened.
    await expect(
      recordRun({
        job: "memory-summarize",
        startedAt: new Date(),
        finishedAt: new Date(),
        // @ts-expect-error deliberately invalid, to prove it is swallowed
        outcome: "not-a-real-outcome",
        result: {},
      }),
    ).resolves.toBeUndefined();
  });
});
