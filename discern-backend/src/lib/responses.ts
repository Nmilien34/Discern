import type { Response } from "express";
import type { ZodType } from "zod";

import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Every 2xx body is `{ data: ... }`, and every one is VALIDATED ON THE WAY OUT.
 *
 * THE ASYMMETRY THIS CLOSES. The client parses every response against the
 * shared schema (`services/api.ts`). The server did not. So a handler that
 * quietly stopped sending a field compiled, deployed, and was discovered on a
 * device — the most expensive place to find a contract bug, and the only place
 * it was findable.
 *
 * THE SCHEMA IS A REQUIRED ARGUMENT ON PURPOSE. Middleware would have to map
 * route to schema in a table, and a route added without a table entry silently
 * skips validation — the same forgettable failure, one level up. Here a new
 * route does not compile without one.
 *
 * BEHAVIOUR DIFFERS BY ENVIRONMENT, DELIBERATELY:
 *
 *   development / test   THROW. A contract violation is a failing test, loudly,
 *                        at the moment it is introduced.
 *   production           LOG AND SEND ANYWAY. Never turn a schema mismatch into
 *                        a 500 for a person whose data is fine. The response
 *                        that was going to work still works; the error goes to
 *                        the log with the route, the schema and the issues.
 */
export function sendData<T>(
  res: Response,
  schema: ZodType<T>,
  value: T,
  statusCode = 200,
): void {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));

    if (env.NODE_ENV === "production") {
      logger.error(
        {
          route: `${res.req?.method ?? "?"} ${res.req?.originalUrl ?? "?"}`,
          schema: schema.description ?? "unnamed",
          issues,
        },
        "response does not match its contract — sending it anyway",
      );
    } else {
      throw new Error(
        `Response does not match its contract for ` +
          `${res.req?.method ?? "?"} ${res.req?.originalUrl ?? "?"}:\n` +
          issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n"),
      );
    }
  }

  // The value, not the parse result: stripping unknown keys silently would
  // change what ships between environments, and a response that is wrong should
  // be reported rather than quietly repaired.
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
