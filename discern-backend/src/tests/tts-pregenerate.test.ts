// The bug this job had between 5 and 6 September, as a test.
//
// It completed GREEN having synthesized nothing, because the candidate query
// took the first eighty passages in natural order and every one of them was
// already cached. `done` stayed at zero and the job reported success. Nothing
// in the system distinguished "nothing left to do" from "the query cannot see
// the work".
//
// So the assertion is not "the job runs". It is: a run that produces nothing
// while uncached passages exist must NOT report skipped, and must report the
// remaining work.
//
// Runs against local mongod. Skips rather than fails when it is unreachable.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { JobReport } from "../jobs/job-run.service";
import { PassageModel, SpeechCacheModel, TranslationModel } from "../models";

// synthesize() is the only thing here that would cost money. Stubbed, and the
// stub asserts it is never called with more than the per-request cap.
const synthesized: { reference: string; translationId: string; chars: number }[] = [];
vi.mock("../services/speech/tts", () => ({
  synthesize: vi.fn(
    async (
      text: string,
      _purpose: string,
      options: { passageReference?: string; translationId?: string },
    ) => {
      synthesized.push({
        reference: options.passageReference ?? "",
        translationId: options.translationId ?? "",
        chars: text.length,
      });
      return { url: "s3://x", s3Key: "x", characters: text.length, cached: false };
    },
  ),
  voiceSettings: () => ({}),
}));

let connected = false;
let web: mongoose.Types.ObjectId;
let kjv: mongoose.Types.ObjectId;

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
    await Promise.all([
      PassageModel.deleteMany({ bookSlug: "tts-test" }),
      SpeechCacheModel.deleteMany({ voiceId: "tts-test-voice" }),
      TranslationModel.deleteMany({ abbreviation: /^TT/ }),
    ]);
    await mongoose.disconnect();
  }
});

/** Two translations and `n` passages, of which `cachedCount` are already done. */
async function seed(n: number, cachedCount: number) {
  await Promise.all([
    PassageModel.deleteMany({ bookSlug: "tts-test" }),
    SpeechCacheModel.deleteMany({ voiceId: "tts-test-voice" }),
    TranslationModel.deleteMany({ abbreviation: /^TT/ }),
  ]);
  synthesized.length = 0;

  const created = await TranslationModel.create([
    { abbreviation: "TTA", name: "Test A", licenseType: "public-domain", copyrightNotice: "-", isDefault: true },
    { abbreviation: "TTB", name: "Test B", licenseType: "public-domain", copyrightNotice: "-", isDefault: false },
  ]);
  web = created[0]!._id;
  kjv = created[1]!._id;

  for (let i = 0; i < n; i += 1) {
    const reference = `TtsTest ${String(i).padStart(3, "0")}:1`;
    await PassageModel.create({
      reference,
      bookSlug: "tts-test",
      chapter: 1,
      startVerse: 1,
      endVerse: 1,
      endChapter: 1,
      stageSlugs: ["pride-humility"],
      texts: new Map([
        [String(web), `Alpha text for ${reference}.`],
        [String(kjv), `Beta text for ${reference}.`],
      ]),
    });

    // The old bug's precondition: the HEAD of the corpus is fully cached.
    if (i < cachedCount) {
      for (const t of [web, kjv]) {
        await SpeechCacheModel.create({
          hash: `h-${reference}-${String(t)}`,
          s3Key: "k",
          characters: 10,
          voiceId: "tts-test-voice",
          passageReference: reference,
          translationId: String(t),
        });
      }
    }
  }
}

async function runJob(limit: number): Promise<JobReport> {
  const { HANDLERS } = await import("../jobs/handlers");
  let report: JobReport = { result: {} };
  await HANDLERS["tts-pregenerate"](
    { payload: { limit } } as never,
    (r) => {
      report = r;
    },
  );
  return report;
}

describe("tts-pregenerate", () => {
  beforeEach(() => {
    process.env.VOICE_ENABLED = "true";
  });

  it("REACHES uncached passages past a fully cached head of the corpus", async ({ skip }) => {
    if (!connected) skip();

    // 30 passages, the first 25 cached in both translations. The old query took
    // the first `limit * 4` in natural order and would have found nothing.
    await seed(30, 25);

    const report = await runJob(4);

    expect(report.result.synthesized).toBe(4);
    expect(report.skipped).toBe(false);
    expect(synthesized).toHaveLength(4);
    // Everything it touched is past the cached head.
    for (const s of synthesized) expect(s.reference >= "TtsTest 025:1").toBe(true);
  });

  it("must NOT report skipped when it produced nothing while work remains", async ({ skip }) => {
    if (!connected) skip();

    await seed(30, 25);

    // limit 0: the job can do nothing, but ten pairs are still uncached.
    const report = await runJob(0);

    expect(report.result.synthesized).toBe(0);
    // THE REGRESSION. Green-and-idle while work exists is the bug.
    expect(report.skipped).toBe(false);
    expect(report.result.missingWhenFinished).toBeGreaterThan(0);
  });

  it("reports skipped only when the corpus is genuinely covered", async ({ skip }) => {
    if (!connected) skip();

    await seed(6, 6);

    const report = await runJob(10);

    expect(report.result.synthesized).toBe(0);
    expect(report.result.missingWhenFinished).toBe(0);
    expect(report.skipped).toBe(true);
  });

  it("treats each TRANSLATION as its own work — one cached does not skip the other", async ({
    skip,
  }) => {
    if (!connected) skip();

    await seed(2, 0);
    // Cache translation A only, for both passages.
    for (const i of [0, 1]) {
      const reference = `TtsTest ${String(i).padStart(3, "0")}:1`;
      await SpeechCacheModel.create({
        hash: `h-a-${reference}`,
        s3Key: "k",
        characters: 10,
        voiceId: "tts-test-voice",
        passageReference: reference,
        translationId: String(web),
      });
    }

    await runJob(10);

    // Only translation B was synthesized — and it WAS synthesized, which the
    // reference-only skip-set made impossible.
    expect(synthesized).toHaveLength(2);
    for (const s of synthesized) expect(s.translationId).toBe(String(kjv));
  });
});
