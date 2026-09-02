import { deviceAuthRequestSchema, linkAccountRequestSchema } from "@discern/shared";
import type { DeviceAuthRequest, LinkAccountRequest } from "@discern/shared";
import { Router } from "express";

import { issueToken } from "../auth/tokens";
import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { requireAuth } from "../middleware/auth.middleware";
import {
  deviceAuthLimiter,
  linkAuthLimiter,
} from "../middleware/rate-limit.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { UserModel } from "../models";
import { linkAccount } from "../services/users/account-link.service";
import { verifyIdentityToken } from "../services/users/identity-verification";

export const authRouter: Router = Router();

/**
 * POST /v1/auth/device — register or resolve an anonymous device.
 *
 * No signup wall (ARCHITECTURE.md §10 decision 2). IDEMPOTENT on deviceId: a
 * reinstall, a retried request, or a flaky network returns the SAME account
 * rather than orphaning everything behind a second one.
 */
authRouter.post(
  "/device",
  deviceAuthLimiter,
  validateBody(deviceAuthRequestSchema),
  asyncHandler(async (req, res) => {
    const { deviceId, preferences } = req.body as DeviceAuthRequest;

    const before = await UserModel.findOne({ deviceId }).select("_id");

    const user = await UserModel.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          lastActiveAt: new Date(),
          ...(preferences?.translationId
            ? { "preferences.translationId": preferences.translationId }
            : {}),
          ...(preferences?.notificationTime !== undefined
            ? { "preferences.notificationTime": preferences.notificationTime }
            : {}),
          ...(preferences?.voiceEnabled !== undefined
            ? { "preferences.voiceEnabled": preferences.voiceEnabled }
            : {}),
        },
        $setOnInsert: { deviceId },
      },
      { new: true, upsert: true },
    );

    sendData(res, {
      token: issueToken(String(user._id)),
      userId: String(user._id),
      created: before === null,
    });
  }),
);

/**
 * POST /v1/auth/link — upgrade a device to a real account.
 *
 * The identity token is VERIFIED against the provider before anything happens:
 * signature, issuer, audience, expiry and nonce. The account id comes from the
 * verified subject, never from the request.
 *
 * The response's `userId` may DIFFER from the caller's when the outcome is
 * `merged`: the account holder survives and the device user is folded into it.
 * The app must replace its stored token and id with the ones returned here.
 *
 * The old token keeps working either way — loadUser follows the merge pointer —
 * so a device that misses this response is degraded, not broken.
 */
authRouter.post(
  "/link",
  linkAuthLimiter,
  requireAuth,
  validateBody(linkAccountRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as LinkAccountRequest;

    // VERIFY FIRST, AND TAKE THE IDENTITY FROM THE TOKEN.
    //
    // Nothing about which account gets linked comes from the request. The
    // subject is whatever Apple signed, so a caller cannot ask to be merged
    // into somebody else's account — there is no field for it and the value
    // is not read from the body.
    const identity = await verifyIdentityToken(
      body.provider,
      body.identityToken,
      body.nonce,
    );

    const result = await linkAccount(req.user?.id ?? "", {
      provider: body.provider,
      accountId: identity.subject,
      ...(identity.email ? { email: identity.email } : {}),
    });

    sendData(res, {
      token: issueToken(String(result.user._id)),
      userId: String(result.user._id),
      outcome: result.outcome,
      ...(result.moved ? { moved: result.moved } : {}),
    });
  }),
);
