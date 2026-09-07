// A wrong door is worse than no door, because a wrong door is trusted.
//
// `openThreads` carries a `conversationId` so Abigail's tab and Home's
// *Continue with Abigail* have somewhere to go. The summariser is given one
// transcript spanning up to 36 hours and returns a flat list of strings, so
// when more than one conversation falls in that window there is no way to know
// which thread came from which.
//
// The shortcut — attribute everything to the most recent — is wrong invisibly:
// somebody taps a thread expecting the thing they left open and lands
// somewhere unrelated, with nothing to indicate a mistake was made. So
// attribution is STRICT: exactly one conversation, or null.
//
// The ambiguous case is the whole point of this file.
//
// Own database, and the model call is stubbed — a real one would spend money
// and the property under test is not what she writes.

import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("../lib/openai-client", () => ({
  openaiFor: () => ({ chat: { completions: { create } } }),
}));

// Static imports are fine: vi.mock is hoisted above them, so the job module
// picks up the stub when it is loaded.
import { summarizeYesterday } from "../jobs/memory-summary";
import { ConversationModel, MessageModel, UserMemoryModel, UserModel } from "../models";

let connected = false;

beforeAll(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!, {
      dbName: `${process.env.MONGODB_DB_NAME}-attribution`,
      serverSelectionTimeoutMS: 1500,
    });
    connected = true;
  } catch {
    connected = false;
  }
});

afterAll(async () => {
  if (connected) await mongoose.disconnect();
});

let user: mongoose.Types.ObjectId;

beforeEach(async () => {
  if (!connected) return;
  await Promise.all([
    ConversationModel.deleteMany({}),
    MessageModel.deleteMany({}),
    UserMemoryModel.deleteMany({}),
    UserModel.deleteMany({ deviceId: /^attr-/ }),
  ]);
  user = (await UserModel.create({ deviceId: `attr-${Date.now()}` }))._id;

  create.mockReset();
  create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            threads: ["the conversation he has not had", "whether to go on Sunday"],
          }),
        },
      },
    ],
  });
});

/** A conversation with one message in it, `hoursAgo` back. */
async function conversationAt(hoursAgo: number): Promise<mongoose.Types.ObjectId> {
  const startedAt = new Date(Date.now() - hoursAgo * 3_600_000);
  const conversation = await ConversationModel.create({ userId: user, mode: "text", startedAt });
  await MessageModel.create({
    conversationId: conversation._id,
    userId: user,
    role: "user",
    content: "I keep rehearsing it and never saying it.",
    createdAt: startedAt,
  });
  return conversation._id;
}

const threadsFor = async () =>
  (await UserMemoryModel.findOne({ userId: user }).lean())?.openThreads ?? [];

describe("thread attribution is strict", () => {
  it("ONE conversation in the window: threads point at it", async ({ skip }) => {
    if (!connected) skip();
    const only = await conversationAt(4);

    await summarizeYesterday(String(user));

    const threads = await threadsFor();
    expect(threads).toHaveLength(2);
    for (const t of threads) expect(String(t.conversationId)).toBe(String(only));
  });

  it("TWO conversations: threads are NULL, not pointed at the newer one", async ({ skip }) => {
    if (!connected) skip();
    // The case this file exists for. Somebody talked in the morning about one
    // thing and in the evening about another; the summariser returns two
    // threads and does not say which is which. Guessing "the newer one" is
    // right half the time and wrong invisibly the other half.
    const older = await conversationAt(30);
    const newer = await conversationAt(2);

    await summarizeYesterday(String(user));

    const threads = await threadsFor();
    expect(threads).toHaveLength(2);
    for (const t of threads) {
      expect(t.conversationId ?? null).toBeNull();
      // Explicitly not the newer one, which is the shortcut being refused.
      expect(String(t.conversationId)).not.toBe(String(newer));
      expect(String(t.conversationId)).not.toBe(String(older));
    }
  });

  it("THREE conversations: still null", async ({ skip }) => {
    if (!connected) skip();
    await conversationAt(30);
    await conversationAt(12);
    await conversationAt(1);

    await summarizeYesterday(String(user));
    for (const t of await threadsFor()) expect(t.conversationId ?? null).toBeNull();
  });

  it("a null thread still stores its TEXT — the loss is the door, not the thread", async ({ skip }) => {
    if (!connected) skip();
    // Null already has a rendering path: it is what every thread written before
    // 2026-09-07 gets, and it shows the text with no way in.
    await conversationAt(30);
    await conversationAt(2);

    await summarizeYesterday(String(user));
    const threads = await threadsFor();
    expect(threads.map((t) => t.text)).toEqual([
      "the conversation he has not had",
      "whether to go on Sunday",
    ]);
  });

  it("a conversation OUTSIDE the 36-hour window does not create ambiguity", async ({ skip }) => {
    if (!connected) skip();
    // Only what the summariser was actually shown can make attribution
    // uncertain. A conversation from last week is not in the transcript.
    await conversationAt(200);
    const inWindow = await conversationAt(3);

    await summarizeYesterday(String(user));
    for (const t of await threadsFor()) {
      expect(String(t.conversationId)).toBe(String(inWindow));
    }
  });
});
