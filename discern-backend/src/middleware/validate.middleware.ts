import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";

import { ValidationError } from "../lib/errors";

function formatIssues(error: {
  issues: { path: (string | number)[]; message: string }[];
}) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError("Invalid request body", formatIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new ValidationError("Invalid query parameters", formatIssues(result.error)),
      );
      return;
    }
    // Express 5 makes req.query a read-only getter, so the parsed value has to
    // be redefined onto the request rather than assigned. Pepta and Corner both
    // hit this.
    Object.defineProperty(req, "query", {
      value: result.data,
      writable: false,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError("Invalid path parameters", formatIssues(result.error)));
      return;
    }
    next();
  };
}
