import type { NextFunction, Request, Response } from "express";
import { Router } from "express";

import { env } from "../config/env";
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

/**
 * GET /v1/billing/products
 *
 * What is for sale, as IDENTIFIERS. THE SERVER NEVER STATES A PRICE.
 *
 * The client resolves the real price from StoreKit (or Play Billing), so
 * localization, currency, regional pricing and any change made in App Store
 * Connect are automatically correct. A price returned from here could only
 * ever be a second copy of the truth, and the copy is the one that goes stale
 * — right in the code and wrong on the screen.
 *
 * SHAPED FOR MORE THAN ONE STORE. Products are grouped by store rather than
 * returned as a flat list, so adding Google Play later is a new key rather than
 * a breaking change to every client already parsing this.
 *
 * UNGATED, like the rest of billing: someone who cannot pay yet is exactly who
 * needs to see what is on offer.
 */
billingRouter.get(
  "/products",
  asyncHandler(async (_req, res) => {
    const apple = [
      {
        id: env.APPLE_PRODUCT_ANNUAL,
        period: "annual" as const,
        // The 7-day trial is an introductory offer on the ANNUAL sku only —
        // monthly charges immediately (ARCHITECTURE.md 10 decision 4). The
        // client needs this to render "start free trial" against the right one.
        hasIntroductoryOffer: true,
        displayOrder: 1,
      },
      {
        id: env.APPLE_PRODUCT_MONTHLY,
        period: "monthly" as const,
        hasIntroductoryOffer: false,
        displayOrder: 2,
      },
    ];

    const google =
      env.GOOGLE_PRODUCT_ANNUAL && env.GOOGLE_PRODUCT_MONTHLY
        ? [
            {
              id: env.GOOGLE_PRODUCT_ANNUAL,
              period: "annual" as const,
              hasIntroductoryOffer: true,
              displayOrder: 1,
            },
            {
              id: env.GOOGLE_PRODUCT_MONTHLY,
              period: "monthly" as const,
              hasIntroductoryOffer: false,
              displayOrder: 2,
            },
          ]
        : [];

    sendData(res, {
      stores: {
        apple,
        // Absent until configured, rather than an empty array pretending the
        // store exists.
        ...(google.length > 0 ? { google } : {}),
      },
      /**
       * Both SKUs sit in ONE subscription group so the provider resolves a
       * single entitlement and a person can move between them without ending
       * up with two (ARCHITECTURE.md 10 decision 4).
       */
      singleSubscriptionGroup: true,
      trialAvailableOn: "annual",
    });
  }),
);
