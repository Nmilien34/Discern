// SERVING AND BULK ARE SEPARATE LEDGERS.
//
// On 2026-09-03 a corpus pregeneration wrote 8.4M characters through the same
// global counter that live requests check against, so for the rest of that day
// every genuinely new passage was refused for every user. Cache hits were
// unaffected, which is the only reason it was not a visible incident — the
// guard causing the outage it exists to prevent.
//
// The property, both directions: a bulk run at its limit must not refuse a
// serving request, and a serving day at its limit must not refuse a bulk run.

import { describe, expect, it, beforeEach, vi } from "vitest";

const rows = new Map<string, { charactersSynthesized: number; requests: number }>();

vi.mock("../models", () => ({
  SpeechUsageModel: {
    findOneAndUpdate: vi.fn(async (q: { scope: string }, u: { $inc: Record<string, number> }) => {
      const row = rows.get(q.scope) ?? { charactersSynthesized: 0, requests: 0 };
      row.charactersSynthesized += u.$inc.charactersSynthesized ?? 0;
      row.requests += u.$inc.requests ?? 0;
      rows.set(q.scope, row);
      return row;
    }),
    updateOne: vi.fn(async (q: { scope: string }, u: { $inc: Record<string, number> }) => {
      const row = rows.get(q.scope);
      if (row) {
        row.charactersSynthesized += u.$inc.charactersSynthesized ?? 0;
        row.requests += u.$inc.requests ?? 0;
      }
    }),
    find: vi.fn(() => ({ lean: async () => [] })),
  },
}));

vi.mock("../config/env", async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return {
    ...actual,
    env: {
      ...actual.env,
      TTS_DAILY_CHARS_PER_USER: 1_000,
      TTS_DAILY_CHARS_GLOBAL: 2_000,
      TTS_BULK_DAILY_CHARS: 10_000,
      TTS_MAX_CHARS_PER_REQUEST: 5_000,
    },
  };
});

beforeEach(() => rows.clear());

describe("bulk cannot draw down serving", () => {
  it("a bulk run at its limit still leaves serving fully available", async () => {
    const { reserveSpeechSpend } = await import("../services/speech/spend");

    // Spend the entire bulk budget.
    const bulk = await reserveSpeechSpend("pregen", "tts", 10_000, "bulk");
    expect(bulk.allowed).toBe(true);

    const overBulk = await reserveSpeechSpend("pregen", "tts", 1, "bulk");
    expect(overBulk.allowed).toBe(false);
    expect(overBulk.limit).toBe("bulk-daily");

    // THE POINT: a real listener is unaffected.
    const serving = await reserveSpeechSpend("a-real-person", "tts", 500, "serving");
    expect(serving.allowed).toBe(true);

    // And the serving counters never saw the bulk characters.
    expect(rows.get("global")?.charactersSynthesized).toBe(500);
    expect(rows.get("bulk")?.charactersSynthesized).toBe(10_000);
  });

  it("the corpus-run scenario: 8.4M of bulk, serving still works", async () => {
    const { reserveSpeechSpend } = await import("../services/speech/spend");

    for (let i = 0; i < 9; i += 1) {
      await reserveSpeechSpend("pregen", "tts", 1_000, "bulk");
    }

    const listener = await reserveSpeechSpend("someone", "tts", 900, "serving");
    expect(listener.allowed).toBe(true);
    expect(listener.limit).toBeNull();
  });
});

describe("serving cannot draw down bulk", () => {
  it("a serving day at its global limit still leaves bulk available", async () => {
    const { reserveSpeechSpend } = await import("../services/speech/spend");

    // Two users exhaust the global serving budget.
    expect((await reserveSpeechSpend("u1", "tts", 1_000, "serving")).allowed).toBe(true);
    expect((await reserveSpeechSpend("u2", "tts", 1_000, "serving")).allowed).toBe(true);

    const over = await reserveSpeechSpend("u3", "tts", 100, "serving");
    expect(over.allowed).toBe(false);
    expect(over.limit).toBe("global-daily");

    // An operator can still warm the cache.
    const bulk = await reserveSpeechSpend("pregen", "tts", 9_000, "bulk");
    expect(bulk.allowed).toBe(true);
    expect(rows.get("bulk")?.charactersSynthesized).toBe(9_000);
  });
});

describe("the scope is explicit", () => {
  it("a bulk refusal names the bulk limit, not a user's", async () => {
    const { reserveSpeechSpend } = await import("../services/speech/spend");
    await reserveSpeechSpend("pregen", "tts", 10_000, "bulk");
    const refused = await reserveSpeechSpend("pregen", "tts", 1, "bulk");

    // The message has to tell an operator that LIVE audio is fine, or they
    // will assume they have taken the product down.
    expect(refused.reason).toMatch(/live audio is unaffected/i);
    expect(refused.limitValue).toBe(10_000);
  });

  it("bulk skips the per-user ceiling entirely", async () => {
    // 10,000 characters would blow a 1,000-character per-user limit ten times
    // over. Bulk is not a user and must not be measured as one.
    const { reserveSpeechSpend } = await import("../services/speech/spend");
    const bulk = await reserveSpeechSpend("pregen", "tts", 10_000, "bulk");
    expect(bulk.allowed).toBe(true);
    expect(rows.get("user:pregen")).toBeUndefined();
  });
});
