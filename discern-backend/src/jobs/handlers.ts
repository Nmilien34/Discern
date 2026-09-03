// THE HANDLERS. One function per job type, registered by name.
//
// Every one is written to be RE-RUNNABLE. A lease expires, a worker is
// redeployed mid-job, a retry fires — each of those means a handler runs again
// on work it may have partly done, so "already done" must be a no-op rather
// than a duplicate.

import { logger } from "../lib/logger";
import {
  ConversationModel,
  JobModel,
  MessageModel,
  PassageModel,
  SpeechCacheModel,
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
import { enqueue } from "./queue";
import { speakable } from "../services/speech/sentences";
import { synthesize } from "../services/speech/tts";
import { embedMissingPassages } from "./embedding-backfill";

export type JobHandler = (job: JobDocument) => Promise<void>;

/**
 * 1. EMBEDDING BACKFILL. Already scripted; this puts it under the runner so it
 *    is retried, leased and observable like everything else instead of being a
 *    thing somebody remembers to run.
 */
const embeddingBackfill: JobHandler = async (job) => {
  const limit = Number(job.payload.limit ?? 200);
  const { embedded, remaining } = await embedMissingPassages(limit);

  logger.info({ embedded, remaining }, "embedding backfill batch complete");

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
const ttsPregenerate: JobHandler = async (job) => {
  const limit = Math.min(Number(job.payload.limit ?? 20), 100);

  const cached = new Set(
    (await SpeechCacheModel.find({ passageReference: { $ne: null } })
      .select("passageReference")
      .lean()).map((r) => r.passageReference),
  );

  const passages = await PassageModel.find({
    handling: { $ne: "on-request-only" },
    stageSlugs: { $exists: true, $ne: [] },
  })
    .select("reference texts")
    .limit(limit * 4)
    .lean();

  let done = 0;

  for (const p of passages) {
    if (done >= limit) break;
    if (cached.has(p.reference)) continue;

    const texts = p.texts as unknown as Map<string, string> | Record<string, string>;
    const first =
      texts instanceof Map ? [...texts.values()][0] : Object.values(texts ?? {})[0];
    const text = speakable(String(first ?? ""));
    if (!text) continue;

    // "pregen" has its own ceiling scope, so warming the cache can never
    // consume a real person's daily allowance.
    const result = await synthesize(text, "pregen", {
      passageReference: p.reference,
      scope: "bulk",
    });

    if (result?.refusedReason) {
      // A ceiling refusal will refuse everything after it. Stop rather than
      // burn the remaining attempts discovering that repeatedly.
      logger.warn({ reason: result.refusedReason }, "tts pregeneration stopped by the ceiling");
      return;
    }

    done += 1;
  }

  logger.info({ pregenerated: done }, "tts pregeneration batch complete");
};

/**
 * 3. NIGHTLY MEMORY SUMMARY. The one that matters most.
 *
 *    Yesterday's conversations become openThreads, which is the difference
 *    between someone who knows you and a fresh chat every time.
 */
const memorySummarize: JobHandler = async (job) => {
  const userId = String(job.payload.userId ?? "");
  if (!userId) throw new Error("memory-summarize requires a userId");
  await summarizeYesterday(userId);
};

/**
 * 4a. NOTIFICATION SCHEDULING. Runs often, sends nothing.
 *
 *     Finds people whose chosen minute it is IN THEIR OWN ZONE and enqueues one
 *     send. Someone who has not chosen a time is never found, because
 *     `notificationTime: null` is the shipped default and it means silence.
 */
const notificationSchedule: JobHandler = async () => {
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
};

/**
 * 4b. NOTIFICATION SEND.
 *
 *     Composition refuses off-brand copy by throwing, and silence is a correct
 *     outcome — no carrying means nothing to say, and nothing to say means
 *     nothing is sent.
 */
const notificationSend: JobHandler = async (job) => {
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
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const active = await ConversationModel.distinct("userId", {
    startedAt: { $gte: since },
  });

  for (const userId of active) {
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
