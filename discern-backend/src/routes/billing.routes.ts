import type { NextFunction, Request, Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { validateBody } from "../middleware/validate.middleware";
import {
  applyRevenueCatWebhook,
  revenueCatWebhookSchema,
  verifyRevenueCatSecret,
} from "../services/billing/revenuecat.service";

export const billingRouter: Router = Router();

function requireRevenueCatSecret(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    verifyRevenueCatSecret(
      req.get("authorization") ?? req.get("x-revenuecat-webhook-secret"),
    );
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /v1/billing/webhook
 *
 * No requireAuth: the caller is RevenueCat, not a user. Authentication is the
 * timing-safe shared-secret check, and it FAILS CLOSED — 503 when no secret is
 * configured, 403 on a mismatch. Never "process it anyway".
 */
billingRouter.post(
  "/webhook",
  requireRevenueCatSecret,
  validateBody(revenueCatWebhookSchema),
  asyncHandler(async (req, res) => {
    sendData(res, await applyRevenueCatWebhook(req.body));
  }),
);
