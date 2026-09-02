import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Forwards a rejected promise to the error middleware.
 *
 * Express 5 does forward rejections from async handlers on its own, but this
 * stays explicit for two reasons: it keeps handler signatures uniform whether
 * or not they are async, and it matches Pepta and Corner so the backends read
 * the same way.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
