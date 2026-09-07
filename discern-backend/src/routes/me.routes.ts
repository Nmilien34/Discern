import {
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  meResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesSchema,
  onboardingResponseSchema,
  onboardingStepSchema,
} from "@discern/shared";
import type { DeleteAccountRequest } from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { deleteAccountLimiter } from "../middleware/rate-limit.middleware";
import { accessViewFor } from "../middleware/require-entitlement.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { UnauthorizedError } from "../lib/errors";
import { deleteAccount } from "../services/users/account-deletion.service";
import { verifyIdentityToken } from "../services/users/identity-verification";
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

    sendData(res, meResponseSchema, {
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

    sendData(res, notificationPreferencesResponseSchema, {
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

    sendData(res, onboardingResponseSchema, {
      completed: (user?.onboarding ?? []).map((s) => ({
        step: s.step,
        completedAt: s.completedAt.toISOString(),
      })),
    });
  }),
);

/**
 * DELETE /v1/me — account deletion.
 *
 * Apple requires in-app deletion from any app that offers account creation, so
 * this is a submission blocker rather than a feature.
 *
 * RE-AUTHENTICATED. A valid session token is not enough: a phone left unlocked
 * on a table already has one. A linked account must present its provider token
 * again, and its subject must match the account on file. An anonymous account
 * presents its device id, because there is no provider to assert against and
 * holding the device is the strongest claim available.
 *
 * IDEMPOTENT. Every step is a deleteMany, so a retry after a partial failure
 * finishes the job instead of erroring on rows that are already gone. The user
 * document is removed last, which is what makes a half-finished run resumable —
 * the account is still there to be found and re-walked.
 */
meRouter.delete(
  "/",
  requireAuth,
  loadUser,
  deleteAccountLimiter,
  validateBody(deleteAccountRequestSchema),
  asyncHandler(async (req, res) => {
    const user = req.currentUser!;
    const body = req.body as DeleteAccountRequest;

    if ("identityToken" in body) {
      // A fresh assertion from the provider, and it has to be THIS account.
      const identity = await verifyIdentityToken(
        body.provider,
        body.identityToken,
        body.nonce,
      );

      if (!user.accountId || identity.subject !== user.accountId) {
        throw new UnauthorizedError(
          "That sign-in does not match the account being deleted.",
        );
      }
    } else {
      // ANONYMOUS PATH. Someone who purchased before signing up and never
      // finished still has data, and requiring them to create an account before
      // they may delete one would be absurd.
      if (body.deviceId !== user.deviceId) {
        throw new UnauthorizedError(
          "That device does not match the account being deleted.",
        );
      }
    }

    const result = await deleteAccount(user._id);

    sendData(res, deleteAccountResponseSchema, {
      deletedAt: result.deletedAt,
      removed: result.removed,
      retained: result.retained,
      // Apple owns the subscription; we own the account. Deleting one does not
      // touch the other, and a person who assumes otherwise gets charged again.
      subscriptionUnaffected: true as const,
    });
  }),
);
