// THE CEILING. Built before the feature it bounds.
//
// ElevenLabs is the only cost in this app that scales with one person's
// enthusiasm. A model call is bounded by what a turn costs; a per-character
// speech API is bounded by nothing, and the realistic disaster is not a
// devoted subscriber but a client stuck in a retry loop overnight.
//
// TWO PROPERTIES MATTER MORE THAN THE NUMBERS:
//
// 1. IT IS CHECKED BY INCREMENTING, NOT BY READING. `$inc` returns the value
//    AFTER the addition, so two concurrent turns cannot both read "under the
//    limit" and both proceed. Each sees its own total including its own share.
//
// 2. TRIPPING IT DEGRADES TO TEXT, NEVER FAILS THE TURN. A subscriber losing
//    audio for a night is a bad evening. A subscriber losing Abigail is a
//    cancelled subscription, and the reply is already written by the time
//    synthesis is even attempted.

import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { SpeechUsageModel } from "../../models";

export type SpeechKind = "tts" | "stt";

export interface SpendDecision {
  allowed: boolean;
  /** Set when refused. Shown to the person, so it is written for them. */
  reason: string | null;
  /** Which ceiling stopped it, for logs and for deciding what to raise. */
  limit: "user-daily" | "global-daily" | "per-request" | "bulk-daily" | null;
  usedToday: number;
  limitValue: number;
}

/** UTC day. A boundary that does not move with the reader's timezone. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function bump(
  scope: string,
  kind: SpeechKind,
  amount: number,
): Promise<number> {
  const field =
    kind === "tts" ? "charactersSynthesized" : "secondsTranscribed";

  const row = await SpeechUsageModel.findOneAndUpdate(
    { scope, day: today() },
    { $inc: { [field]: amount, requests: 1 } },
    { upsert: true, new: true },
  );

  return kind === "tts" ? row.charactersSynthesized : row.secondsTranscribed;
}

/** Give back what was reserved when the provider call never happened. */
async function refund(
  scope: string,
  kind: SpeechKind,
  amount: number,
): Promise<void> {
  const field = kind === "tts" ? "charactersSynthesized" : "secondsTranscribed";
  await SpeechUsageModel.updateOne(
    { scope, day: today() },
    { $inc: { [field]: -amount, requests: -1 } },
  );
}

/**
 * Reserve `amount` against both ceilings, or refuse.
 *
 * RESERVES FIRST. A refusal refunds what it just added, which costs one extra
 * write on the path nobody takes and buys a check that cannot be raced.
 */
/**
 * TWO LEDGERS, AND THEY NEVER TOUCH.
 *
 *   serving  live user requests. Tight limits, because their job is to stop a
 *            retry loop — passage-only plus a permanent cache already removed
 *            the business-model exposure they were originally guarding.
 *   bulk     operator-initiated pregeneration. Its own much larger limit, its
 *            own row, and it draws down NOTHING from serving.
 *
 * The corpus run is why this exists. It wrote 8.4M characters into the same
 * global counter serving uses, so for the rest of that day every genuinely new
 * passage was refused for every user — the guard causing the outage it exists
 * to prevent. Cache hits were unaffected, which is the only reason it was not
 * a visible incident.
 *
 * SCOPE IS EXPLICIT AT THE CALL SITE. It is not inferred from the user id, not
 * from a magic "pregen" string, and not from whether a request looks automated.
 * A caller that wants the large budget has to say so.
 */
export type SpendScope = "serving" | "bulk";

export async function reserveSpeechSpend(
  userId: string,
  kind: SpeechKind,
  amount: number,
  scope: SpendScope,
): Promise<SpendDecision> {
  const perUserLimit =
    kind === "tts"
      ? env.TTS_DAILY_CHARS_PER_USER
      : env.STT_DAILY_SECONDS_PER_USER;
  const globalLimit =
    kind === "tts" ? env.TTS_DAILY_CHARS_GLOBAL : env.STT_DAILY_SECONDS_GLOBAL;

  // ---- BULK: one row, one limit, and no contact with serving.
  if (scope === "bulk") {
    const bulkLimit =
      kind === "tts" ? env.TTS_BULK_DAILY_CHARS : env.STT_BULK_DAILY_SECONDS;
    const bulkTotal = await bump("bulk", kind, amount);

    if (bulkTotal > bulkLimit) {
      await refund("bulk", kind, amount);
      logger.warn(
        { kind, bulkTotal, bulkLimit },
        "speech ceiling: BULK daily limit reached — serving is unaffected",
      );
      return {
        allowed: false,
        reason:
          "The pregeneration budget for today is spent. Live audio is " +
          "unaffected; run the rest tomorrow or raise TTS_BULK_DAILY_CHARS.",
        limit: "bulk-daily",
        usedToday: bulkTotal - amount,
        limitValue: bulkLimit,
      };
    }

    return {
      allowed: true,
      reason: null,
      limit: null,
      usedToday: bulkTotal,
      limitValue: bulkLimit,
    };
  }

  if (kind === "tts" && amount > env.TTS_MAX_CHARS_PER_REQUEST) {
    return {
      allowed: false,
      reason:
        "That reply is too long to read aloud in one piece. You have it in text.",
      limit: "per-request",
      usedToday: 0,
      limitValue: env.TTS_MAX_CHARS_PER_REQUEST,
    };
  }

  const userScope = `user:${userId}`;
  const userTotal = await bump(userScope, kind, amount);

  if (userTotal > perUserLimit) {
    await refund(userScope, kind, amount);
    logger.warn(
      { userId, kind, userTotal, perUserLimit },
      "speech ceiling: per-user daily limit reached",
    );
    return {
      allowed: false,
      reason:
        "You have reached today's limit for spoken replies. Abigail will keep " +
        "answering in text, and audio returns tomorrow.",
      limit: "user-daily",
      usedToday: userTotal - amount,
      limitValue: perUserLimit,
    };
  }

  const globalTotal = await bump("global", kind, amount);

  if (globalTotal > globalLimit) {
    await refund("global", kind, amount);
    await refund(userScope, kind, amount);
    // Loud: this one is not a user's behaviour, it is the whole service.
    logger.error(
      { kind, globalTotal, globalLimit },
      "SPEECH CEILING: GLOBAL DAILY LIMIT REACHED — voice is off for everyone until tomorrow",
    );
    return {
      allowed: false,
      reason:
        "Spoken replies are unavailable right now. Abigail will keep answering " +
        "in text.",
      limit: "global-daily",
      usedToday: globalTotal - amount,
      limitValue: globalLimit,
    };
  }

  return {
    allowed: true,
    reason: null,
    limit: null,
    usedToday: userTotal,
    limitValue: perUserLimit,
  };
}

/** Hand back a reservation when the provider call failed. */
export async function releaseSpeechSpend(
  userId: string,
  kind: SpeechKind,
  amount: number,
  scope: SpendScope,
): Promise<void> {
  if (scope === "bulk") {
    await refund("bulk", kind, amount);
    return;
  }

  await Promise.all([
    refund(`user:${userId}`, kind, amount),
    refund("global", kind, amount),
  ]);
}

/** Reporting only. Nothing bills off these numbers. */
export function estimateUsd(kind: SpeechKind, amount: number): number {
  return kind === "tts"
    ? (amount / 1000) * env.TTS_USD_PER_1K_CHARS
    : (amount / 60) * env.STT_USD_PER_MINUTE;
}

export async function speechUsageToday(userId?: string): Promise<{
  scope: string;
  charactersSynthesized: number;
  secondsTranscribed: number;
  requests: number;
}[]> {
  // BULK IS REPORTED SEPARATELY, always. A cost report that adds a corpus run
  // to a day of live listening says the product costs a thousand times what it
  // does, and the whole point of the split is that they are different money.
  const scopes = ["global", "bulk", ...(userId ? [`user:${userId}`] : [])];

  const rows = await SpeechUsageModel.find({
    scope: { $in: scopes },
    day: today(),
  }).lean();

  return scopes.map((scope) => {
    const row = rows.find((r) => r.scope === scope);
    return {
      scope: scope === "global" ? "serving (global)" : scope,
      charactersSynthesized: row?.charactersSynthesized ?? 0,
      secondsTranscribed: row?.secondsTranscribed ?? 0,
      requests: row?.requests ?? 0,
    };
  });
}
