import { deviceAuthRequestSchema, linkAccountRequestSchema } from "@discern/shared";
import type { DeviceAuthRequest, LinkAccountRequest } from "@discern/shared";
import { Router } from "express";

import { issueToken } from "../auth/tokens";
import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { requireAuth } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { UserModel } from "../models";
import { linkAccount } from "../services/users/account-link.service";

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
 * The response's `userId` may DIFFER from the caller's when the outcome is
 * `merged`: the account holder survives and the device user is folded into it.
 * The app must replace its stored token and id with the ones returned here.
 *
 * The old token keeps working either way — loadUser follows the merge pointer —
 * so a device that misses this response is degraded, not broken.
 */
authRouter.post(
  "/link",
  requireAuth,
  validateBody(linkAccountRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as LinkAccountRequest;
    const result = await linkAccount(req.user?.id ?? "", body);

    sendData(res, {
      token: issueToken(String(result.user._id)),
      userId: String(result.user._id),
      outcome: result.outcome,
      ...(result.moved ? { moved: result.moved } : {}),
    });
  }),
);
