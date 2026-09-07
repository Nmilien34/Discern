// Operational health: job names, timestamps, counts, and each job's own small
// result payload.
//
// OPERATOR-ONLY SINCE 2026-09-06, and the previous gate is worth recording.
// This route carried `requireAuth`, which reads like a gate and is not one:
// `POST /v1/auth/device` mints a token from an arbitrary device id with no
// credential, so any stranger was one unauthenticated call from reading it. The
// header comment then said the endpoint "carries no user data" — and two job
// handlers report a `userId` in their result (memory-summary and
// notification-send), which `jobHealth()` returns verbatim.
//
// It stays OUTSIDE the entitlement gate, which was the right call for the wrong
// reason: a paywall in front of "are the jobs running" would hide the answer
// exactly when it matters. The fix is a different gate, not a stronger one —
// this is an operator question, so it takes an operator secret.

import { jobHealthResponseSchema } from "@discern/shared";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env";
import { asyncHandler } from "../lib/async-handler";
import { UnauthorizedError } from "../lib/errors";
import { sendData } from "../lib/responses";
import { jobHealth } from "../services/ops/job-health.service";

export const opsRouter = Router();

/**
 * Whether the ops surface exists at all. Unset OPS_TOKEN means unmounted, not
 * open — see app.ts. There is no default-open state to misconfigure.
 */
export function opsEnabled(): boolean {
  return typeof env.OPS_TOKEN === "string";
}

function requireOpsToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Not a user token and never compared against one: a user token that happened
  // to match would be a much stranger bug than a rejected operator.
  if (!env.OPS_TOKEN || presented !== env.OPS_TOKEN) {
    next(new UnauthorizedError("Operator credentials required"));
    return;
  }
  next();
}

/**
 * GET /v1/ops/jobs
 *
 * One row per job in JOB_TYPES, always, whether or not it has ever run. A job
 * that has never executed reports `state: "never-run"` rather than being
 * missing from the response — a missing row is precisely the failure mode that
 * let "have the jobs ever run" go unanswered for four days.
 */
opsRouter.get(
  "/jobs",
  requireOpsToken,
  asyncHandler(async (_req, res) => {
    sendData(res, jobHealthResponseSchema, await jobHealth());
  }),
);
