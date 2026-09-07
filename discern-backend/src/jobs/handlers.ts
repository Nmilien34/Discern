// THE HANDLERS. One function per job type, registered by name.
//
// Every one is written to be RE-RUNNABLE. A lease expires, a worker is
// redeployed mid-job, a retry fires — each of those means a handler runs again
// on work it may have partly done, so "already done" must be a no-op rather
// than a duplicate.

import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  ConversationModel,
  JobModel,
  MessageModel,
  PassageModel,
  SpeechCacheModel,
  TranslationModel,
  UserMemoryModel,
  UserModel,
} from "../models";
import type { JobDocument, JobType } from "../models";
import { summarizeYesterday } from "./memory-summary";
import {
  alreadyNotifiedToday,
  composeNotification,
  isDue,
  markNotified,
} from "./notifications";
import { enqueue, TerminalJobError } from "./queue";
import { speakable } from "../services/speech/sentences";
import { synthesize } from "../services/speech/tts";
import { embedMissingPassages } from "./embedding-backfill";
import type { Reporter } from "./job-run.service";

// `report` is how a handler says what it DID. Existing handlers that take only
// `job` remain assignable, so adding it did not touch any call site.
export type JobHandler = (job: JobDocument, report: Reporter) => Promise<void>;

/**
 * 1. EMBEDDING BACKFILL. Already scripted; this puts it under the runner so it
 *    is retried, leased and observable like everything else instead of being a
 *    thing somebody remembers to run.
 */
const embeddingBackfill: JobHandler = async (job, report) => {
  const limit = Number(job.payload.limit ?? 200);
  const { embedded, remaining } = await embedMissingPassages(limit);

  logger.info({ embedded, remaining }, "embedding backfill batch complete");
  // `skipped` when there was nothing to embed. As of 2026-09-06 all 4,102
  // passages already carry an embedding — put there by scripts/embed-corpus.ts,
  // not by this job, which has never run. That is a legitimate no-op and it
  // should read as one rather than as a success.
  report({ result: { embedded, remaining, limit }, skipped: embedded === 0 });

  // Self-continuing: one batch per job so a lease is never held for an hour.
  if (remaining > 0) {
    await enqueue({
      type: "embedding-backfill",
      idempotencyKey: `embedding-backfill:${new Date().toISOString().slice(0, 13)}:${remaining}`,
      payload: { limit },
      runAfter: new Date(Date.now() + 5_000),
    });
  }
};

/**
 * 2. TTS PREGENERATION. Warms the Phase 7 cache for the passages she actually
 *    hands over, so the first person to hear one is not the person who waits.
 *
 *    Stage anchors first, then whatever has been offered most. Bounded per job
 *    because this spends money.
 */
const ttsPregenerate: JobHandler = async (job, report) => {
  // TERMINAL. VOICE_ENABLED does not become true because we waited 4 minutes.
  // Before this check the job backed off 60s, 120s, 240s against a config
  // value, doubling toward a queue that looks stuck.
  if (!env.VOICE_ENABLED) {
    throw new TerminalJobError(
      "VOICE_ENABLED is false, so there is nothing to pregenerate. Set it and " +
        "re-enqueue; retrying cannot turn a flag on.",
      "feature-disabled",
    );
  }

  const limit = Math.min(Number(job.payload.limit ?? 20), 100);

  // ── THREE BUGS FIXED HERE, 2026-09-06 ──────────────────────────────────────
  //
  // 1. THE CANDIDATE QUERY TOOK THE FIRST 80 PASSAGES OF EVERYTHING.
  //    `.limit(limit * 4)` with no sort and no filter for uncached. With 7,819
  //    cache rows the first eighty in natural order were all cached, so the
  //    loop skipped every one, `done` stayed at zero, and the job reported
  //    success. It had been "succeeding" and producing nothing since 5
  //    September. The candidate set is now built from what is actually MISSING.
  //
  // 2. THE SKIP-SET WAS KEYED ON REFERENCE ALONE, so a passage cached in one
  //    translation was skipped in the other — forever. Measured on 2026-09-06:
  //    that wrongly skipped 3,914 passage/translation pairs, which is the
  //    entire KJV corpus. The key is now reference AND translation.
  //
  // 3. ONLY ONE TRANSLATION WAS EVER SYNTHESIZED. `[...texts.values()][0]`
  //    takes Map insertion order, which is why an earlier run produced KJV
  //    when it meant WEB. Every translation of a passage is now a separate
  //    unit of work with its own identity.
  //
  // The skip-set is an OPTIMISATION, not the guard. `synthesize()` looks up by
  // content hash and returns `cached: true` without spending, so a label that
  // is stale costs one lookup rather than one recording. That matters, because
  // 3,911 of the cache rows pre-date the translationId column and carry null.
  const cachedPairs = new Set(
    (
      await SpeechCacheModel.find({ passageReference: { $ne: null } })
        .select("passageReference translationId")
        .lean()
    ).map((r) => `${r.passageReference}|${r.translationId ?? ""}`),
  );

  const translations = await TranslationModel.find({}).select("_id").lean();

  // Sorted, so successive runs walk the corpus in a stable order and make
  // progress instead of re-scanning the same head of an unordered collection.
  const passages = await PassageModel.find({
    handling: { $ne: "on-request-only" },
    stageSlugs: { $exists: true, $ne: [] },
  })
    .select("reference texts")
    .sort({ reference: 1 })
    .lean();

  let scanned = 0;
  let alreadyCached = 0;
  let overCap = 0;
  let done = 0;
  let characters = 0;

  outer: for (const p of passages) {
    for (const t of translations) {
      const translationId = String(t._id);
      scanned += 1;

      if (cachedPairs.has(`${p.reference}|${translationId}`)) {
        alreadyCached += 1;
        continue;
      }

      const texts = p.texts as unknown as Map<string, string> | Record<string, string>;
      const raw =
        texts instanceof Map ? texts.get(translationId) : (texts ?? {})[translationId];
      const text = speakable(String(raw ?? ""));
      if (!text) continue;

      // OVER THE PER-REQUEST CAP. Counted and skipped rather than attempted:
      // three references exceed it in both translations (Psalm 119,
      // 2 Samuel 11:1-12:25, Psalm 78) and they need the chunking work in
      // DEFERRED.md §9, not a retry loop against a limit.
      if (text.length > env.TTS_MAX_CHARS_PER_REQUEST) {
        overCap += 1;
        continue;
      }

      if (done >= limit) break outer;

      // "pregen" has its own ceiling scope, so warming the cache can never
      // consume a real person's daily allowance.
      const result = await synthesize(text, "pregen", {
        passageReference: p.reference,
        translationId,
        scope: "bulk",
      });

      if (result?.refusedReason) {
        // Not terminal: a DAILY ceiling clears at midnight, so this job simply
        // stops and the next day's enqueue picks it up.
        logger.warn(
          { reason: result.refusedReason, limit: result.refusedLimit, pregenerated: done },
          "tts pregeneration stopped by the ceiling; resuming tomorrow",
        );
        report({
          result: { synthesized: done, characters, scanned, alreadyCached, overCap, stoppedBy: result.refusedReason },
          skipped: done === 0,
        });
        return;
      }

      if (result && !result.cached) characters += result.characters;
      done += 1;
    }
  }

  const missing = scanned - alreadyCached;

  logger.info({ pregenerated: done, scanned, alreadyCached, overCap }, "tts pregeneration batch complete");

  // `skipped` ONLY when there was genuinely nothing to do. A run that did
  // nothing while work remained is the bug this job just had, and it must not
  // report the same thing as a run that did nothing because the corpus is
  // fully covered.
  report({
    result: { synthesized: done, characters, scanned, alreadyCached, overCap, missingWhenFinished: missing - done },
    skipped: done === 0 && missing - done === 0,
  });
};

const memorySummarize: JobHandler = async (job, report) => {
  const userId = String(job.payload.userId ?? "");

  // TERMINAL. A payload does not grow a userId on the third attempt.
  if (!userId) {
    throw new TerminalJobError(
      "memory-summarize was enqueued without a userId in its payload.",
      "invalid-payload",
    );
  }

  // Everything below CAN fail transiently — an OpenAI 429, a Mongo blip — and
  // those still retry with backoff, which is what backoff is for.
  await summarizeYesterday(userId);
  report({ result: { userId } });
};

/**
 * 4a. NOTIFICATION SCHEDULING. Runs often, sends nothing.
 *
 *     Finds people whose chosen minute it is IN THEIR OWN ZONE and enqueues one
 *     send. Someone who has not chosen a time is never found, because
 *     `notificationTime: null` is the shipped default and it means silence.
 */
const notificationSchedule: JobHandler = async (_job, report) => {
  const candidates = await UserModel.find({
    "preferences.notificationTime": { $ne: null },
    "preferences.pushToken": { $ne: null },
  }).limit(5_000);

  let scheduled = 0;

  for (const user of candidates) {
    if (!isDue(user)) continue;
    if (alreadyNotifiedToday(user)) continue;

    // Keyed by user and DAY, so running this scheduler twice in the same minute
    // — or twice in the same day — cannot produce two notifications.
    const created = await enqueue({
      type: "notification-send",
      idempotencyKey: `notify:${String(user._id)}:${new Date().toISOString().slice(0, 10)}`,
      payload: { userId: String(user._id) },
      maxAttempts: 2,
    });

    if (created) scheduled += 1;
  }

  logger.info({ considered: candidates.length, scheduled }, "notification sweep complete");
  // SKIPPED, not success, when it enqueued nothing. Between 2026-09-03 and
  // 2026-09-06 this ran 821 times and enqueued zero sends — correctly, since no
  // user has a notification time — and every one of those runs looked green.
  report({
    result: { considered: candidates.length, scheduled },
    skipped: scheduled === 0,
  });
};

/**
 * 4b. NOTIFICATION SEND.
 *
 *     Composition refuses off-brand copy by throwing, and silence is a correct
 *     outcome — no carrying means nothing to say, and nothing to say means
 *     nothing is sent.
 */
const notificationSend: JobHandler = async (job, report) => {
  const userId = String(job.payload.userId ?? "");
  const user = await UserModel.findById(userId);

  if (!user || !user.preferences.pushToken) return;
  if (alreadyNotifiedToday(user)) return;

  const notification = await composeNotification(user);

  if (!notification) {
    logger.info({ userId }, "nothing worth saying tonight; staying silent");
    return;
  }

  // DELIVERY IS NOT WIRED. There is no APNs/Expo credential yet, and inventing
  // one would mean this job reports success while sending nothing. It composes,
  // it validates, it records — and the send is one call away when the app
  // exists to receive it.
  logger.info(
    { userId, title: notification.title, body: notification.body },
    "notification composed (delivery not yet wired — no push credential)",
  );

  await markNotified(userId);
  // SKIPPED on purpose. Delivery is not wired, so this composed a notification
  // and sent nothing. Reporting success here would be the exact lie this whole
  // record exists to prevent.
  report({
    result: { userId, composed: true, delivered: false, reason: "no push credential" },
    skipped: true,
  });
};

export const HANDLERS: Record<JobType, JobHandler> = {
  "embedding-backfill": embeddingBackfill,
  "tts-pregenerate": ttsPregenerate,
  "memory-summarize": memorySummarize,
  "notification-schedule": notificationSchedule,
  "notification-send": notificationSend,
};

/**
 * The recurring work, enqueued idempotently.
 *
 * Keys carry the hour or the day, so a worker that restarts every ten minutes
 * re-enqueues nothing.
 */
export async function scheduleRecurring(): Promise<void> {
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13);
  const dayKey = now.toISOString().slice(0, 10);

  await enqueue({
    type: "notification-schedule",
    idempotencyKey: `notification-sweep:${hourKey}:${Math.floor(now.getMinutes() / 5)}`,
  });

  await enqueue({
    type: "tts-pregenerate",
    idempotencyKey: `tts-pregenerate:${dayKey}`,
    payload: { limit: 20 },
  });

  // One summary job per user who spoke to her yesterday. Keyed by user and day.
  //
  // THE USER MUST STILL EXIST. `distinct("userId")` reads the conversations
  // collection, which knows nothing about whether that account is still there —
  // and a deleted user leaves its conversations behind. On 2026-09-04 that
  // meant 442 "active users" against 29 real ones, and the worker spent 732
  // gpt-5-mini calls summarising conversations for accounts that had been
  // cleaned up after eval runs.
  //
  // Summarising a deleted user is not just wasted money. It writes a
  // UserMemory document keyed to an id nothing points at, which is a slow leak
  // of exactly the private material this app should be shedding when an
  // account goes.
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const active = await ConversationModel.distinct("userId", {
    startedAt: { $gte: since },
  });

  const live = new Set(
    (
      await UserModel.find({ _id: { $in: active } })
        .select("_id")
        .lean()
    ).map((u) => String(u._id)),
  );

  const orphaned = active.length - live.size;

  if (orphaned > 0) {
    logger.warn(
      { active: active.length, live: live.size, orphaned },
      "conversations exist for users that no longer do; skipping their summaries",
    );
  }

  for (const userId of active) {
    if (!live.has(String(userId))) continue;

    await enqueue({
      type: "memory-summarize",
      idempotencyKey: `memory-summarize:${String(userId)}:${dayKey}`,
      payload: { userId: String(userId) },
    });
  }
}

/** Queue depth, for the worker's startup and heartbeat logs. */
export async function queueSnapshot(): Promise<Record<string, number>> {
  const rows = await JobModel.aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

export { MessageModel, UserMemoryModel };
