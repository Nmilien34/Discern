import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { accessViewFor } from "../middleware/require-entitlement.middleware";

export const meRouter: Router = Router();

/** GET /v1/me — who this token is, and what they may currently do. */
meRouter.get(
  "/",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const user = req.currentUser;
    if (!user) return;

    sendData(res, {
      userId: String(user._id),
      accountId: user.accountId,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt.toISOString(),
      entitlement: {
        status: user.entitlement.status,
        expiresAt: user.entitlement.expiresAt
          ? user.entitlement.expiresAt.toISOString()
          : null,
        willRenew: user.entitlement.willRenew,
        verificationState: user.entitlement.verificationState,
      },
      currentStageSlug: user.currentStageSlug,
      preferences: {
        translationId: user.preferences.translationId
          ? String(user.preferences.translationId)
          : null,
        notificationTime: user.preferences.notificationTime,
        voiceEnabled: user.preferences.voiceEnabled,
      },
      // No allowance to report. What the app needs is whether access is live,
      // and whether a paywall is the right thing to show — which is NOT the
      // same question during a provider outage.
      access: accessViewFor(user),
      // Analytics only. Gates nothing.
      conversationsStarted: user.abigailConversationsStarted,
    });
  }),
);
