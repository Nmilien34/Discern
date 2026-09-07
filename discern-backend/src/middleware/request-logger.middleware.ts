import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { logger } from "../lib/logger";

/**
 * Accepts an inbound `x-request-id` or mints one, echoes it on the response,
 * and logs method/path/status/duration on finish. Same shape as Pepta and Corner.
 *
 * The inbound value is length-bounded: it is attacker-controlled and ends up in
 * every log line for the request.
 */

/**
 * Paths logged at `debug` rather than `info`.
 *
 * `/healthz` is polled about 17,000 times a day and was the entire content of
 * the production logs — a real request was one line in several hundred, which
 * makes the log unreadable exactly when someone is reading it for a reason.
 *
 * DEBUG, NOT SILENCE. The line still exists and comes back the moment LOG_LEVEL
 * is turned down, which matters because a health check that starts failing or
 * slowing is a genuine signal. Filtering by PATH rather than by status is the
 * reason that still works: a 500 from /healthz is exactly as interesting as a
 * 200 and would have been hidden by a status filter.
 */
const QUIET_PATHS = new Set(["/healthz"]);

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerValue = req.header("x-request-id");
  const requestId =
    headerValue && headerValue.length <= 200 ? headerValue : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // `req.path` rather than `originalUrl`: a query string must not make a
    // health check look like a different route and climb back to info.
    const quiet = QUIET_PATHS.has(req.path);

    logger[quiet ? "debug" : "info"](
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        // ONLY ON THE QUIET PATHS, and it is there to answer a specific
        // question: two different clients are polling /healthz on different
        // intervals and nothing in this codebase does it, so one of them is
        // configured somewhere nobody has looked. The user agent is what tells
        // them apart, and now that these lines are cheap they can afford to
        // carry it. Set LOG_LEVEL=debug for a minute and the answer is in the
        // log; if both agents come back empty, `x-forwarded-for` is the
        // fallback and is deliberately not logged by default.
        ...(quiet ? { userAgent: req.header("user-agent") ?? null } : {}),
      },
      "request completed",
    );
  });

  next();
}
