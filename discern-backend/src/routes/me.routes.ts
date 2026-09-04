import {
  notificationPreferencesSchema,
  onboardingStepSchema,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { accessViewFor } from "../middleware/require-entitlement.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { UserModel } from "../models";

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
      // What they have already been through, so the app re-runs only what is
      // new rather than the whole flow on a reinstall.
      onboarding: user.onboarding.map((s) => ({
        step: s.step,
        completedAt: s.completedAt.toISOString(),
      })),
      preferences: {
        notificationTime: user.preferences.notificationTime,
        timezone: user.preferences.timezone,
        pushRegistered: Boolean(user.preferences.pushToken),
        speakReplies: user.preferences.speakReplies,
        translationId: user.preferences.translationId
          ? String(user.preferences.translationId)
          : null,
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

/**
 * PUT /v1/me/notifications
 *
 * Registers a push token and the ONE thing that decides whether anything is
 * ever sent: a time the person chose.
 *
 * THERE IS NO DEFAULT AND THERE IS NO OPT-OUT, because there is nothing to opt
 * out of. `notificationTime: null` is the shipped state and it means silence.
 * Sending a token here does not subscribe anyone to anything.
 *
 * The token alone is not consent. Registering for push and asking to be
 * reminded are separate decisions and this endpoint keeps them separate.
 */
meRouter.put(
  "/notifications",
  requireAuth,
  loadUser,
  validateBody(notificationPreferencesSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      pushToken?: string | null;
      notificationTime?: string | null;
      timezone?: string | null;
      speakReplies?: boolean | null;
    };

    const update: Record<string, unknown> = {};
    if (body.pushToken !== undefined) update["preferences.pushToken"] = body.pushToken;
    if (body.notificationTime !== undefined)
      update["preferences.notificationTime"] = body.notificationTime;
    if (body.timezone !== undefined) update["preferences.timezone"] = body.timezone;
    // null clears the override and defers to SPEAK_REPLIES again.
    if (body.speakReplies !== undefined)
      update["preferences.speakReplies"] = body.speakReplies;

    const user = await UserModel.findOneAndUpdate(
      { _id: req.currentUser!._id },
      { $set: update },
      { new: true },
    );

    sendData(res, {
      pushRegistered: Boolean(user?.preferences.pushToken),
      notificationTime: user?.preferences.notificationTime ?? null,
      timezone: user?.preferences.timezone ?? null,
      // Said back explicitly so a client cannot assume registering was enough.
      willNotify: Boolean(user?.preferences.pushToken && user?.preferences.notificationTime),
      speakReplies: user?.preferences.speakReplies ?? null,
    });
  }),
);

/**
 * POST /v1/me/onboarding
 *
 * Records that a step was completed. Idempotent: completing the same step
 * twice keeps the FIRST timestamp, because the question this answers is "has
 * this person been through it", not "when did they last tap it".
 *
 * There is no endpoint to clear a step. Onboarding is a thing that happened,
 * and un-happening it is not a product need.
 */
meRouter.post(
  "/onboarding",
  requireAuth,
  loadUser,
  validateBody(onboardingStepSchema),
  asyncHandler(async (req, res) => {
    const { step } = req.body as { step: string };

    // $addToSet on `step` alone will not do — the documents carry a timestamp
    // and would never compare equal — so completion is checked explicitly.
    const already = req.currentUser!.onboarding.some((s) => s.step === step);

    const user = already
      ? req.currentUser!
      : await UserModel.findOneAndUpdate(
          { _id: req.currentUser!._id },
          { $push: { onboarding: { step, completedAt: new Date() } } },
          { new: true },
        );

    sendData(res, {
      completed: (user?.onboarding ?? []).map((s) => ({
        step: s.step,
        completedAt: s.completedAt.toISOString(),
      })),
    });
  }),
);
