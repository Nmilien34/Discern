// What she remembers, read and removed.
//
// The nightly job has been writing `userMemory` since Phase 6 and the prompt
// builder has been reading it, and no endpoint exposed it — so the promise made
// on three separate screens ("everything stored about you, in plain words,
// remove any of it") was not keepable. This is the half that makes it true.
//
// DELETING IS NOT A NICETY. A product that says it remembers you needs a way to
// say forget that, and the removal has to reach the thing the prompt builder
// actually reads, not a flag beside it.

import type { Types } from "mongoose";

import { NotFoundError, ValidationError } from "../../lib/errors";
import { UserMemoryModel, UserModel } from "../../models";
import type { MemoryResponse } from "@discern/shared";

/**
 * Everything stored about someone, in the shape Settings renders.
 *
 * `vices` comes from the onboarding answers rather than from `userMemory`,
 * because round 15 ruled the vice selection sensitive and required it to appear
 * here and be deletable here. It is stored elsewhere; it belongs on this screen.
 */
export async function readMemory(userId: Types.ObjectId): Promise<MemoryResponse> {
  const [memory, user] = await Promise.all([
    UserMemoryModel.findOne({ userId }).lean(),
    UserModel.findById(userId).select("onboardingAnswers").lean(),
  ]);

  return {
    openThreads: (memory?.openThreads ?? []).map((t) => ({
      text: t.text,
      at: t.at.toISOString(),
      // NULL FOR ANY THREAD WRITTEN BEFORE 2026-09-07, and not backfilled.
      //
      // The nightly job REPLACES openThreads wholesale rather than appending,
      // so every pre-existing thread is rewritten within a day and a backfill
      // would be guesswork with a shelf life of hours. The client renders a
      // null as text with no way in, which is what it honestly is.
      conversationId: t.conversationId ? String(t.conversationId) : null,
    })),
    facts: (memory?.facts ?? []).map((f, i) => ({
      id: String(i),
      text: f.text,
      at: f.at.toISOString(),
    })),
    peopleMentioned: (memory?.peopleMentioned ?? []).map((p, i) => ({
      id: String(i),
      name: p.name,
      relationship: p.relationship ?? null,
    })),
    vices: user?.onboardingAnswers?.vices ?? [],
    lastSummarisedAt: memory?.updatedAt ? memory.updatedAt.toISOString() : null,
  };
}

/**
 * Removes one remembered thing.
 *
 * Facts and people are addressed by INDEX, which is what `readMemory` hands
 * out, so a delete is only valid against the list the client is looking at. If
 * the nightly job rewrote the list in between, the index no longer means what
 * the client thought and the delete is refused rather than applied to whatever
 * moved into that position.
 */
export async function forgetMemory(
  userId: Types.ObjectId,
  kind: "thread" | "fact" | "person",
  id: string,
): Promise<boolean> {
  const memory = await UserMemoryModel.findOne({ userId });
  if (!memory) throw new NotFoundError("Nothing is remembered yet");

  const index = Number(id);
  if (!Number.isInteger(index) || index < 0) {
    throw new ValidationError("Invalid memory id", [
      { path: "id", message: "must be the index returned by GET /v1/me/memory" },
    ]);
  }

  const list =
    kind === "thread"
      ? memory.openThreads
      : kind === "fact"
        ? memory.facts
        : memory.peopleMentioned;

  if (index >= list.length) return false;

  list.splice(index, 1);
  await memory.save();
  return true;
}
