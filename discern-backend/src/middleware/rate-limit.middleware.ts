// RATE LIMITING.
//
// There was none until 2026-09-02. Every Abigail turn costs roughly five cents
// of OpenAI credit and the API is on the public internet, so an entitled token
// in a loop was an uncapped bill with nobody watching. The paywall bounded WHO
// could spend, never HOW MUCH.
//
// Two axes, because they stop different things:
//
//   per user   one subscriber cannot run a script. Generous enough that a real
//              person in a hard week never sees it.
//   per IP     one machine cannot cycle through accounts, and unauthenticated
//              routes that mint tokens have a ceiling at all.
//
// IN-PROCESS, AND THAT IS A REAL LIMITATION. Counters live in this process's
// memory: they reset on deploy and they do not add up across instances. On one
// Render instance that is honest and adequate. THE DAY A SECOND INSTANCE EXISTS
// THIS BECOMES per-instance AND THE EFFECTIVE LIMIT DOUBLES — at which point it
// has to move to Mongo or a shared key-value store. It is written so that swap
// touches only `hit()`.

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { RateLimitedError } from "../lib/errors";
import { logger } from "../lib/logger";

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Every counter, keyed by "<limiter>:<subject>".
 *
 * Swept rather than left to grow: an unbounded map keyed by client IP is a
 * memory leak with a stranger holding the pen.
 */
const windows = new Map<string, Window>();

const SWEEP_INTERVAL_MS = 60_000;
/** Hard ceiling. Past this the map is cleared rather than allowed to grow. */
const MAX_TRACKED = 50_000;

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size > MAX_TRACKED) {
    logger.warn(
      { tracked: windows.size },
      "rate limiter tracking too many keys — clearing; this looks like a distributed probe",
    );
    windows.clear();
  }
}, SWEEP_INTERVAL_MS);

// Do not hold the process open for a housekeeping timer.
sweep.unref();

/** The one place a counter is read and written. Swap this for a shared store. */
function hit(key: string, windowMs: number): Window {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    windows.set(key, fresh);
    return fresh;
  }

  existing.count += 1;
  return existing;
}

export interface RateLimitOptions {
  /** Appears in the key and the log line. */
  name: string;
  windowMs: number;
  max: number;
  /**
   * `user` limits a subscriber; `ip` limits a machine.
   *
   * A `user` limiter placed before authentication would key everything to
   * "anonymous" and rate-limit the whole world as one bucket, so it falls back
   * to the IP and says so rather than silently doing that.
   */
  by: "user" | "ip";
}

/** Behind Render's proxy the client address is the first X-Forwarded-For hop. */
function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first ?? req.socket.remoteAddress ?? "unknown").trim();
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { name, windowMs, max, by } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const subject =
      by === "user" && req.currentUser
        ? `u:${String(req.currentUser._id)}`
        : `ip:${clientIp(req)}`;

    const window = hit(`${name}:${subject}`, windowMs);

    const remaining = Math.max(0, max - window.count);
    const resetSeconds = Math.ceil((window.resetAt - Date.now()) / 1000);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (window.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));

      logger.warn(
        { limiter: name, subject, count: window.count, max },
        "rate limit exceeded",
      );

      next(
        new RateLimitedError(
          `Too many requests. Try again in ${resetSeconds} second${resetSeconds === 1 ? "" : "s"}.`,
          { limit: max, windowSeconds: Math.round(windowMs / 1000), retryAfterSeconds: resetSeconds },
        ),
      );
      return;
    }

    next();
  };
}

/**
 * THE EXPENSIVE ROUTE. An Abigail turn is 3-8 model calls and roughly $0.05.
 *
 * 30/hour and 150/day are both far above any real use — the eval's longest
 * conversation is two turns, and a person in a hard week might have a handful —
 * and both are useless to a loop, which is the whole point. Two windows because
 * one hourly limit still allows 720 turns a day.
 */
export const abigailTurnLimiters: RequestHandler[] = [
  rateLimit({ name: "abigail-hour", windowMs: 60 * 60 * 1000, max: 30, by: "user" }),
  rateLimit({ name: "abigail-day", windowMs: 24 * 60 * 60 * 1000, max: 150, by: "user" }),
  // Catches one machine spreading turns across many accounts.
  rateLimit({ name: "abigail-ip-hour", windowMs: 60 * 60 * 1000, max: 60, by: "ip" }),
];

/**
 * UNGATED AND IT MINTS TOKENS.
 *
 * /v1/auth/device is idempotent on deviceId, so a real device calls it once per
 * install and occasionally after that. Unlimited, it is free account creation
 * and unbounded row growth on a shared cluster.
 */
export const deviceAuthLimiter: RequestHandler = rateLimit({
  name: "auth-device",
  windowMs: 60 * 60 * 1000,
  max: 20,
  by: "ip",
});

/**
 * Voice input. Costed per minute, and a 10 MB upload per call.
 *
 * Lower than the turn limiter because a transcription is cheaper than a turn
 * but the upload is not free, and a loop here spends both bandwidth and
 * ElevenLabs minutes.
 */
export const transcribeLimiter: RequestHandler = rateLimit({
  name: "transcribe",
  windowMs: 60 * 60 * 1000,
  max: 60,
  by: "user",
});

/** Ungated and does real verification work on every call. */
export const linkAuthLimiter: RequestHandler = rateLimit({
  name: "auth-link",
  windowMs: 60 * 60 * 1000,
  max: 20,
  by: "ip",
});

/** Test seam: counters are process-local, so they leak between test cases. */
export function resetRateLimitsForTests(): void {
  windows.clear();
}
