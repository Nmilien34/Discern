// OpenAI clients, with EXPLICIT timeouts.
//
// The SDK's default request timeout is TEN MINUTES. Every call in this codebase
// used it until 2026-09-02, which on a 0.5 CPU instance means one hung upstream
// request can hold a connection and its memory for the length of a lunch break,
// while the person who sent it has long since closed the app.
//
// Timeouts are per-purpose because the tolerances genuinely differ, and each is
// set from the MEASURED p90 with headroom rather than from a round number:
//
//   safety      p90 well under a second, and it gates every turn. It fails
//               CLOSED, so a timeout returns crisis resources — which is the
//               right answer when the alternative is waiting.
//   hyde        p90 12.9s measured on Render.
//   embedding   p90 0.5s measured.
//   premise     one question, one answer.
//   reasoning   p90 33s per round measured, max 37s. The most generous, because
//               a timeout here loses the whole turn.
//
// `maxRetries` matters as much as the timeout: the SDK retries twice by default,
// so a 90s timeout is really 270s of patience. Retries are kept only where the
// call is cheap and the user is not waiting on a chain of them.

import OpenAI from "openai";

import { env } from "../config/env";

export type OpenAIPurpose =
  | "safety"
  | "premise"
  | "reasoning"
  | "hyde"
  | "embedding";

interface Budget {
  timeoutMs: number;
  maxRetries: number;
}

const BUDGETS: Record<OpenAIPurpose, Budget> = {
  // Fails closed, so waiting is strictly worse than giving up early.
  safety: { timeoutMs: 15_000, maxRetries: 1 },
  premise: { timeoutMs: 30_000, maxRetries: 1 },
  // 2-3 of these per turn, sequentially. Retries here multiply the wait.
  hyde: { timeoutMs: 25_000, maxRetries: 0 },
  embedding: { timeoutMs: 20_000, maxRetries: 2 },
  // Up to 8 rounds. 90s x 1 retry is already a 3-minute worst case per round.
  reasoning: { timeoutMs: 90_000, maxRetries: 1 },
};

const clients = new Map<OpenAIPurpose, OpenAI>();

/** One client per purpose, built once. */
export function openaiFor(purpose: OpenAIPurpose): OpenAI {
  const existing = clients.get(purpose);
  if (existing) return existing;

  const budget = BUDGETS[purpose];
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: budget.timeoutMs,
    maxRetries: budget.maxRetries,
  });

  clients.set(purpose, client);
  return client;
}

/** Exposed so the latency breakdown can report what it was working against. */
export const OPENAI_BUDGETS: Readonly<Record<OpenAIPurpose, Budget>> = BUDGETS;
