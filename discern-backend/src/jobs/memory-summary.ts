// NIGHTLY MEMORY SUMMARY — the job that decides whether she feels like someone
// who knows you.
//
// Without it every conversation starts cold. She has `facts` and
// `peopleMentioned` written during turns, but nothing that says WHERE THINGS
// WERE LEFT — and "how did it go with your brother?" is the difference between
// a companion and a chat window.
//
// THREADS ARE WRITTEN CAREFULLY, because getting this wrong is worse than not
// doing it. A thread that misremembers, or that reopens something the person
// closed, is an app claiming to know you and being wrong about it. So:
//
//   - only genuinely UNFINISHED things, never a summary of what was said
//   - phrased as what THEY were working on, never as a task she set them
//   - at most three, so the oldest fall away instead of accumulating forever
//   - nothing at all is a correct outcome, and the common one

import { models } from "../config/models";
import { openaiFor } from "../lib/openai-client";
import { logger } from "../lib/logger";
import { ConversationModel, MessageModel, UserMemoryModel } from "../models";

const MAX_OPEN_THREADS = 3;

const SYSTEM_PROMPT = `You read one person's conversations from the last day with a spiritual
companion, and you write down anything that was LEFT UNFINISHED.

An open thread is something this person was in the middle of. A conversation
they said they would have. A passage they were sitting with. A decision they had
not made. Something they were going to try.

It is NOT:
- a summary of what was discussed
- anything already resolved
- advice, or a task, or something the companion told them to do
- a feeling on its own ("they were sad") — that is a state, not a thread

Write each one as a short phrase from THEIR side, in their words where possible:
  "was going to apologise to his wife but had not yet"
  "sitting with Matthew 5:23-24 and finding it hard"
  "deciding whether to go back to his old church"

Write NOTHING if nothing was genuinely left open. That is normal and expected —
most conversations finish. An empty list is a correct answer and far better than
inventing continuity that was not there.

Return at most three, the most significant first.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["threads"],
  properties: {
    threads: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

/**
 * Summarize one user's last day into open threads.
 *
 * Idempotent by construction: it REPLACES `openThreads` rather than appending,
 * so running twice for the same day produces the same memory rather than six
 * threads.
 */
export async function summarizeYesterday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000);

  const conversations = await ConversationModel.find({
    userId,
    startedAt: { $gte: since },
  })
    .select("_id")
    .lean();

  if (conversations.length === 0) return 0;

  const messages = await MessageModel.find({
    conversationId: { $in: conversations.map((c) => c._id) },
    // Crisis turns are excluded entirely. What someone disclosed at their worst
    // is not raw material for a "where we left off" prompt the next evening.
    safetyIntercepted: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .select("role content")
    .lean();

  if (messages.length === 0) return 0;

  const transcript = messages
    .map((m) => `${m.role === "user" ? "THEM" : "HER"}: ${m.content}`)
    .join("\n\n")
    .slice(0, 24_000);

  try {
    const response = await openaiFor("premise").chat.completions.create({
      model: models.premise,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "threads", strict: true, schema: SCHEMA },
      },
      max_completion_tokens: 2_000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("summary returned empty content");

    const parsed = JSON.parse(content) as { threads: string[] };

    const threads = parsed.threads
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, MAX_OPEN_THREADS)
      .map((text) => ({ text, at: new Date() }));

    // REPLACE, not append. Re-running produces the same memory, and yesterday's
    // threads do not pile up into a list nobody reads.
    await UserMemoryModel.findOneAndUpdate(
      { userId },
      { $set: { openThreads: threads }, $setOnInsert: { userId } },
      { upsert: true },
    );

    logger.info({ userId, threads: threads.length }, "nightly memory summary written");

    return threads.length;
  } catch (error) {
    // A failed summary is a colder conversation, not a broken one. The job
    // retries; her memory simply keeps yesterday's threads until it succeeds.
    logger.warn(
      { userId, err: error instanceof Error ? error.message : error },
      "memory summary failed",
    );
    throw error;
  }
}
