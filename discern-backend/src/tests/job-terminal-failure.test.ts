// A PERMANENT FAILURE DOES NOT GET RETRIED.
//
// Backoff assumes the world will change. Some failures are not like that:
// VOICE_ENABLED being false, a payload with no userId, a job type this build
// has no code for. Retrying those at 30s, 60s, 2m, 4m produces a queue that
// looks busy, logs one line over and over, and achieves nothing — which is
// exactly what tts-pregenerate did against "VOICE_ENABLED is false" before
// this distinction existed.
//
// The rule: TRANSIENT retries with backoff. TERMINAL fails on the first
// attempt, keeps its reason, and waits for a human.

import { describe, expect, it, beforeEach, vi } from "vitest";

const updateOne = vi.fn();

vi.mock("../models", () => ({
  JobModel: { updateOne, create: vi.fn(), findOneAndUpdate: vi.fn(), aggregate: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

/** A job on its first attempt, with plenty of retries left. */
const freshJob = {
  _id: "job1",
  type: "tts-pregenerate",
  attempts: 1,
  maxAttempts: 5,
} as never;

function lastUpdate(): Record<string, unknown> {
  const call = updateOne.mock.calls.at(-1);
  return (call?.[1] as { $set: Record<string, unknown> }).$set;
}

describe("terminal failures", () => {
  it("goes straight to failed on the FIRST attempt, with retries remaining", async () => {
    const { fail, TerminalJobError } = await import("../jobs/queue");

    await fail(
      freshJob,
      new TerminalJobError("VOICE_ENABLED is false", "feature-disabled"),
    );

    const set = lastUpdate();
    expect(set.status).toBe("failed");
    // Not rescheduled. This is the whole point.
    expect(set.runAfter).toBeUndefined();
  });

  it("keeps the reason AND the code, so the fix is findable", async () => {
    const { fail, TerminalJobError } = await import("../jobs/queue");

    await fail(
      freshJob,
      new TerminalJobError("Set it and re-enqueue", "feature-disabled"),
    );

    expect(lastUpdate().lastError).toBe("[feature-disabled] Set it and re-enqueue");
  });

  it("covers every terminal code", async () => {
    const { fail, TerminalJobError } = await import("../jobs/queue");

    for (const code of [
      "feature-disabled",
      "missing-config",
      "invalid-payload",
      "no-handler",
    ] as const) {
      updateOne.mockClear();
      await fail(freshJob, new TerminalJobError("nope", code));
      expect(lastUpdate().status).toBe("failed");
    }
  });
});

describe("transient failures still retry", () => {
  it("a provider 429 is rescheduled with backoff, not failed", async () => {
    const { fail } = await import("../jobs/queue");

    await fail(freshJob, new Error("ElevenLabs returned 429: rate limited"));

    const set = lastUpdate();
    expect(set.status).toBe("queued");
    expect(set.runAfter).toBeInstanceOf(Date);
    expect((set.runAfter as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("a network error is rescheduled", async () => {
    const { fail } = await import("../jobs/queue");
    await fail(freshJob, new Error("ECONNRESET"));
    expect(lastUpdate().status).toBe("queued");
  });

  it("still fails terminally once attempts are exhausted", async () => {
    // The original guard is unchanged: a transient error that never clears
    // stops after maxAttempts rather than retrying forever.
    const { fail } = await import("../jobs/queue");
    await fail({ ...(freshJob as object), attempts: 5, maxAttempts: 5 } as never,
      new Error("still down"));
    expect(lastUpdate().status).toBe("failed");
  });

  it("backoff grows, and a terminal error skips it entirely", async () => {
    const { fail, TerminalJobError } = await import("../jobs/queue");

    await fail({ ...(freshJob as object), attempts: 1 } as never, new Error("blip"));
    const first = (lastUpdate().runAfter as Date).getTime() - Date.now();

    await fail({ ...(freshJob as object), attempts: 3 } as never, new Error("blip"));
    const third = (lastUpdate().runAfter as Date).getTime() - Date.now();

    expect(third).toBeGreaterThan(first);

    await fail(freshJob, new TerminalJobError("config", "missing-config"));
    expect(lastUpdate().runAfter).toBeUndefined();
  });
});
