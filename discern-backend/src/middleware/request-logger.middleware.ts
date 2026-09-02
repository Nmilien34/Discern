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
    logger.info(
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      "request completed",
    );
  });

  next();
}
