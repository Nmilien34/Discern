// A CACHE HIT IS NEVER CHECKED AGAINST THE SPEND CEILING.
//
// Cached playback costs zero credits: the audio is already an object in S3 and
// serving it again is a signed URL, not a provider call. If the ceiling could
// refuse a replay, someone who listened a lot would be locked out of audio that
// costs nothing to give them — and, worse, a bulk pregeneration run would leave
// the day's ledger exhausted and silence voice for every user until midnight.
//
// That very nearly happened: after the corpus run the global ledger held 3.88M
// characters against a 500k limit, and a passage came back refused. The cause
// was a cache MISS (the KJV recording was cached, WEB was requested) falling
// through to an exhausted ceiling — not the ordering. But it is exactly the
// symptom a wrong ordering would produce, which is why the property is pinned
// here rather than left to a reading of the code.
//
// ORDER, from services/speech/tts.ts:
//   1. hash the text, look up SpeechCache  -> HIT returns immediately
//   2. reserveSpeechSpend()                -> only reached on a MISS
//   3. call ElevenLabs, upload to S3, write the cache row

import { describe, expect, it, vi, beforeEach } from "vitest";

const findOneAndUpdate = vi.fn();
const reserveSpeechSpend = vi.fn();
const audioUrl = vi.fn(async (key: string) => `https://signed.example/${key}`);
const fetchMock = vi.fn();

vi.mock("../models", () => ({
  SpeechCacheModel: { findOneAndUpdate, updateOne: vi.fn(), create: vi.fn() },
}));

vi.mock("../services/speech/spend", () => ({
  reserveSpeechSpend,
  releaseSpeechSpend: vi.fn(),
  estimateUsd: () => 0,
}));

vi.mock("../services/speech/storage", () => ({
  putAudio: vi.fn(async () => undefined),
  audioUrl,
}));

vi.mock("../config/env", async (orig) => {
  const actual = (await orig()) as { env: Record<string, unknown> };
  return {
    ...actual,
    env: { ...actual.env, VOICE_ENABLED: true },
    voiceConfig: () => ({
      apiKey: "k",
      voiceId: "v",
      accessKeyId: "a",
      secretAccessKey: "s",
      bucket: "b",
      region: "us-east-1",
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

/** The ceiling, fully exhausted. Every reservation is refused. */
function exhaustTheCeiling(): void {
  reserveSpeechSpend.mockResolvedValue({
    allowed: false,
    reason: "Spoken replies are unavailable right now.",
    limit: "global-daily",
    usedToday: 3_882_655,
    limitValue: 500_000,
  });
}

describe("a cache hit with the ceiling fully exhausted", () => {
  it("SUCCEEDS, and never consults the ceiling at all", async () => {
    exhaustTheCeiling();
    findOneAndUpdate.mockResolvedValue({
      s3Key: "tts/ab/already-there.mp3",
      characters: 978,
    });

    const { synthesize } = await import("../services/speech/tts");
    const result = await synthesize("Psalm 46, already recorded.", "heavy-user");

    expect(result).not.toBeNull();
    expect(result!.cached).toBe(true);
    expect(result!.refusedReason).toBeUndefined();
    expect(result!.s3Key).toBe("tts/ab/already-there.mp3");

    // THE POINT: the ceiling was never asked. Not "asked and allowed" —
    // never reached, because the function returned before it.
    expect(reserveSpeechSpend).not.toHaveBeenCalled();

    // And no provider call was made, which is why it is free.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses a MISS with the ceiling exhausted", async () => {
    // The other half of the property: the ceiling has to keep working for
    // anything that would actually spend.
    exhaustTheCeiling();
    findOneAndUpdate.mockResolvedValue(null);

    const { synthesize } = await import("../services/speech/tts");
    const result = await synthesize("Something never recorded.", "heavy-user");

    expect(result!.refusedReason).toBeTruthy();
    expect(result!.refusedLimit).toBe("global-daily");
    expect(reserveSpeechSpend).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a hit costs nothing however exhausted the day is", async () => {
    // Ten replays by one person after the ledger is spent: ten successes,
    // zero reservations, zero provider calls.
    exhaustTheCeiling();
    findOneAndUpdate.mockResolvedValue({
      s3Key: "tts/cd/warm.mp3",
      characters: 640,
    });

    const { synthesize } = await import("../services/speech/tts");

    for (let i = 0; i < 10; i += 1) {
      const r = await synthesize("A passage they keep coming back to.", "heavy-user");
      expect(r!.cached).toBe(true);
    }

    expect(reserveSpeechSpend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
