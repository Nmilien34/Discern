// What she remembers, and the way back into it.
//
// THE PRIVACY CLAIM IS MADE ON THREE SCREENS and until now nothing could honour
// it: `userMemory` was written by the nightly job, read by the prompt builder,
// and exposed by no endpoint at all. A product that says it remembers you needs
// a way to say forget that, and the Settings design already draws one.

import { z } from "zod";

/**
 * One thing still open from last time.
 *
 * `conversationId` IS THE WHOLE POINT of this shape. Abigail's tab lists open
 * threads as tappable and Home's *Continue with Abigail* resumes one, and
 * neither was buildable while a thread was `{ text, at }`. The field was
 * precedented eleven lines away in the same model — `MemoryPassageGiven` has
 * carried one since it was written — it simply was never added to threads.
 *
 * NULLABLE, and honestly so. Threads written before 2026-09-07 have no
 * conversation recorded and are NOT backfilled: the nightly job replaces
 * `openThreads` wholesale rather than appending, so every one of them is
 * rewritten within a day and a backfill would be guesswork with a shelf life of
 * hours. Until then a thread comes back with `conversationId: null` and the
 * client renders it as text without a way in, which is what it honestly is.
 */
export const memoryThreadSchema = z
  .object({
    text: z.string(),
    at: z.string(),
    conversationId: z.string().nullable(),
  })
  .strict();

export type MemoryThread = z.infer<typeof memoryThreadSchema>;

/** A thing they SAID. Never inferred — the model records a source for this. */
export const memoryFactSchema = z
  .object({ id: z.string(), text: z.string(), at: z.string() })
  .strict();

export const memoryPersonSchema = z
  .object({ id: z.string(), name: z.string(), relationship: z.string().nullable() })
  .strict();

/**
 * GET /v1/me/memory.
 *
 * UNGATED BY ENTITLEMENT, on `meRouter`. Settings shows this, and someone whose
 * subscription lapsed still gets to see and delete what is stored about them —
 * a paywall in front of "what do you know about me" would be the wrong answer
 * to a question nobody should have to pay to ask.
 */
export const memoryResponseSchema = z
  .object({
    openThreads: z.array(memoryThreadSchema),
    facts: z.array(memoryFactSchema),
    peopleMentioned: z.array(memoryPersonSchema),
    /** The vice they named at onboarding. Round 15 ruled it sensitive, so it is listed here and deletable. */
    vices: z.array(z.string()),
    lastSummarisedAt: z.string().nullable(),
  })
  .strict();

export type MemoryResponse = z.infer<typeof memoryResponseSchema>;

/** What a client may ask her to forget. */
export const MEMORY_KINDS = ["thread", "fact", "person"] as const;

export const deleteMemoryResponseSchema = z
  .object({ kind: z.enum(MEMORY_KINDS), id: z.string(), deleted: z.boolean() })
  .strict();

export type DeleteMemoryResponse = z.infer<typeof deleteMemoryResponseSchema>;

/**
 * GET /v1/me/speech-allowance.
 *
 * The Settings meter and the Voice ceiling screen. INFORMATION, NOT
 * ENFORCEMENT — the ceiling is applied server-side at reserve time whatever
 * this says, and the screen exists so someone is told rather than surprised.
 *
 * `bulk` is reported separately and must never be added to `serving`: a report
 * that folds an operator pregeneration run into a day of live listening says
 * the product costs a thousand times what it does.
 */
export const speechScopeUsageSchema = z
  .object({
    scope: z.string(),
    charactersSynthesized: z.number().int().nonnegative(),
    scriptureCharacters: z.number().int().nonnegative(),
    proseCharacters: z.number().int().nonnegative(),
    secondsTranscribed: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
  })
  .strict();

export const speechAllowanceResponseSchema = z
  .object({
    /** UTC calendar day, which is when every ceiling resets. */
    day: z.string(),
    scopes: z.array(speechScopeUsageSchema),
    /** This person's own ceiling and what is left of it today. */
    charactersUsedToday: z.number().int().nonnegative(),
    charactersPerDay: z.number().int().positive(),
    charactersRemaining: z.number().int().nonnegative(),
    /** False when voice is off for the deployment entirely. */
    voiceEnabled: z.boolean(),
  })
  .strict();

export type SpeechAllowanceResponse = z.infer<typeof speechAllowanceResponseSchema>;
