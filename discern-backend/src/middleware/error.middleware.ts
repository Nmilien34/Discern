import type { NextFunction, Request, Response } from "express";

import { AppError, NotFoundError } from "../lib/errors";
import { logger } from "../lib/logger";

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new NotFoundError(`No route matches ${req.method} ${req.originalUrl}`));
}

/**
 * Central error middleware. Emits the standard failure envelope and never leaks
 * an unexpected error's message to a client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(
          "internal_error",
          error instanceof Error ? error.message : "Unknown error",
          500,
          undefined,
          false,
        );

  const logPayload = {
    requestId: req.requestId,
    code: appError.code,
    status: appError.statusCode,
    path: req.originalUrl,
  };

  if (appError.statusCode >= 500) {
    logger.error({ ...logPayload, err: error }, "request failed");
  } else {
    logger.warn(logPayload, "request rejected");
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      // Unexposed errors get a generic message; the real one is in the log,
      // correlated by requestId.
      message: appError.expose ? appError.message : "Internal server error",
      ...(appError.expose && appError.details !== undefined
        ? { details: appError.details }
        : {}),
    },
  });
}
