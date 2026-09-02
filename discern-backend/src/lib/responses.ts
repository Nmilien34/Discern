import type { Response } from "express";

/** Every 2xx body is `{ data: ... }`. CONVENTIONS.md §3. */
export function sendData<T>(res: Response, value: T, statusCode = 200): void {
  res.status(statusCode).json({ data: value });
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}

/**
 * The scaffold's placeholder response.
 *
 * A real response in the standard error envelope, not a crash and not a 404 —
 * every declared route answers, even before it does anything. Named endpoints
 * from ARCHITECTURE.md §9 that are not yet built should return this rather than
 * being left unmounted, so the app can see the API surface before it is filled in.
 */
export function sendNotImplemented(res: Response, todo: string): void {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "This endpoint is scaffolded but not implemented yet.",
      details: { todo },
    },
  });
}
