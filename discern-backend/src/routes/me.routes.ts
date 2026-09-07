import {
  updatePreferencesRequestSchema,
  preferencesResponseSchema,
  speechAllowanceResponseSchema,
  deleteMemoryResponseSchema,
  memoryResponseSchema,
  deleteAccountRequestSchema,
  deleteAccountResponseSchema,
  meResponseSchema,
  notificationPreferencesResponseSchema,
  notificationPreferencesSchema,
  onboardingResponseSchema,
  onboardingStepSchema,
} from "@discern/shared";
import type {
  DeleteAccountRequest,
  MeResponse,
  OnboardingAnswers,
  UpdatePreferencesRequest,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { deleteAccountLimiter } from "../middleware/rate-limit.middleware";
import { accessViewFor } from "../middleware/require-entitlement.middleware";
import { computeSeed } from "../services/journey/seed.service";
import { forgetMemory, readMemory } from "../services/users/memory.service";
import { speechUsageToday } from "../services/speech/spend";
import { env } from "../config/env";
import { TranslationModel } from "../models";
import { validateBody } from "../middleware/validate.middleware";
import { UnauthorizedError, ValidationError } from "../lib/errors";
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

    // THE TREE'S STAGE ON THE IDENTITY RESPONSE, and only the stage.
    //
    // Settings opens with the glyph and "Sapling, at the fourth of six", and
    // Settings is the screen with RESTORE PURCHASES on it — so the person most
    // likely to open it is a lapsed subscriber, who cannot call the gated
    // `GET /v1/journey/seed`. Two strings here rather than a 402 on the header
    // of the screen somebody opened to resubscribe. Points, the ledger and the
    // contributions stay behind the wall.
    const seed = await computeSeed(user._id);

    sendData(res, meResponseSchema, {
      userId: String(user._id),
      accountId: user.accountId,
      email: user.email,
      name: user.name,
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
      growthStage: seed.growthStage,
      growthStageLabel: seed.growthStageLabel,
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
        typeSize: user.preferences.typeSize,
      },
      onboardingAnswers: {
        name: user.onboardingAnswers.name,
        brought: user.onboardingAnswers.brought,
        vices: user.onboardingAnswers.vices,
        firstVice: user.onboardingAnswers.firstVice,
        situation: user.onboardingAnswers.situation,
        person: user.onboardingAnswers.person,
        familiarity: user.onboardingAnswers.familiarity,
        timeAvailable: user.onboardingAnswers.timeAvailable,
      },
      // No allowance to report. What the app needs is whether access is live,
      // and whether a paywall is the right thing to show — which is NOT the
      // same question during a provider outage.
      access: accessViewFor(user) as MeResponse["access"],
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
    const { step, answers } = req.body as {
      step: string;
      answers?: OnboardingAnswers;
    };

    // ANSWERS ACCUMULATE, THEY DO NOT REPLACE.
    //
    // Each screen sends what it has, so someone who quits at screen 9 and comes
    // back has nine screens of answers rather than none — nothing waits for a
    // final submit that may never arrive. `$set` on named paths rather than on
    // the whole subdocument, so a later screen omitting a field cannot clear
    // what an earlier one stored.
    const answerSet: Record<string, unknown> = {};
    if (answers) {
      for (const [key, value] of Object.entries(answers)) {
        if (value !== undefined) answerSet[`onboardingAnswers.${key}`] = value;
      }
      // The name has an operational home as well as an answer. They start equal
      // and diverge the moment somebody renames themselves in Settings, so both
      // are written and neither is derived from the other.
      if (answers.name !== undefined) answerSet.name = answers.name;
    }


    // $addToSet on `step` alone will not do — the documents carry a timestamp
    // and would never compare equal — so completion is checked explicitly.
    const already = req.currentUser!.onboarding.some((s) => s.step === step);

    const update: Record<string, unknown> = {};
    if (!already) update.$push = { onboarding: { step, completedAt: new Date() } };
    if (Object.keys(answerSet).length > 0) update.$set = answerSet;

    // A repeat of a step that also carries no answers is a no-op, which is what
    // makes this idempotent: the question it answers is "has this person been
    // through it", not "when did they last tap it".
    const user =
      Object.keys(update).length === 0
        ? req.currentUser!
        : ((await UserModel.findOneAndUpdate({ _id: req.currentUser!._id }, update, {
            new: true,
          })) ?? req.currentUser!);

    sendData(res, onboardingResponseSchema, {
      completed: (user?.onboarding ?? []).map((s) => ({
        step: s.step,
        completedAt: s.completedAt.toISOString(),
      })),
      answers: {
        name: user.onboardingAnswers.name,
        brought: user.onboardingAnswers.brought,
        vices: user.onboardingAnswers.vices,
        firstVice: user.onboardingAnswers.firstVice,
        situation: user.onboardingAnswers.situation,
        person: user.onboardingAnswers.person,
        familiarity: user.onboardingAnswers.familiarity,
        timeAvailable: user.onboardingAnswers.timeAvailable,
      },
    });
  }),
);

/**
 * PATCH /v1/me/preferences
 *
 * Settings and onboarding screen 13 write the same fields, so they share one
 * endpoint. NOT merged with `PUT /v1/me/notifications`: a push token and a
 * chosen time are a different decision with a different failure mode, and one
 * endpoint for both would mean a translation change could clear a push token.
 *
 * UNGATED BY ENTITLEMENT, like the rest of `/v1/me`. Someone whose subscription
 * lapsed still gets to change their type size.
 */
meRouter.patch(
  "/preferences",
  requireAuth,
  loadUser,
  validateBody(updatePreferencesRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as UpdatePreferencesRequest;
    const set: Record<string, unknown> = {};

    if (body.translationId !== undefined) {
      // Named, not trusted: an unknown id would store a preference that
      // silently resolves to the default forever after.
      const translation = await TranslationModel.findById(body.translationId)
        .select("_id")
        .lean()
        .catch(() => null);
      if (!translation) {
        throw new ValidationError("Unknown translation", [
          { path: "translationId", message: "no translation has that id" },
        ]);
      }
      set["preferences.translationId"] = translation._id;
    }
    if (body.typeSize !== undefined) set["preferences.typeSize"] = body.typeSize;
    if (body.voiceEnabled !== undefined) set["preferences.voiceEnabled"] = body.voiceEnabled;
    if (body.speakReplies !== undefined) set["preferences.speakReplies"] = body.speakReplies;

    const user =
      (await UserModel.findOneAndUpdate({ _id: req.currentUser!._id }, { $set: set }, { new: true })) ??
      req.currentUser!;

    sendData(res, preferencesResponseSchema, {
      preferences: {
        translationId: user.preferences.translationId
          ? String(user.preferences.translationId)
          : null,
        notificationTime: user.preferences.notificationTime,
        timezone: user.preferences.timezone,
        pushRegistered: Boolean(user.preferences.pushToken),
        speakReplies: user.preferences.speakReplies,
        voiceEnabled: user.preferences.voiceEnabled,
        typeSize: user.preferences.typeSize,
      },
    });
  }),
);

/**
 * GET /v1/me/memory — everything stored about someone, in plain words.
 *
 * The privacy claim is made on three screens and nothing exposed this until
 * now: the nightly job wrote it, the prompt builder read it, and no endpoint
 * returned it.
 *
 * UNGATED BY ENTITLEMENT on purpose. A paywall in front of "what do you know
 * about me" is the wrong answer to a question nobody should have to pay to ask.
 */
meRouter.get(
  "/memory",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(res, memoryResponseSchema, await readMemory(req.currentUser!._id));
  }),
);

/**
 * DELETE /v1/me/memory/:kind/:id — forget one thing.
 *
 * Not a nicety. A product that says it remembers you needs a way to say forget
 * that, and the removal reaches the document the prompt builder actually reads
 * rather than setting a flag beside it.
 *
 * `deleted: false` rather than a 404 when the index is past the end: the list
 * may have been rewritten by the nightly job since the client read it, and that
 * is a stale view rather than an error.
 */
meRouter.delete(
  "/memory/:kind/:id",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const kind = String(req.params.kind);
    if (kind !== "thread" && kind !== "fact" && kind !== "person") {
      throw new ValidationError("Unknown memory kind", [
        { path: "kind", message: "must be thread, fact or person" },
      ]);
    }
    const id = String(req.params.id);
    sendData(res, deleteMemoryResponseSchema, {
      kind,
      id,
      deleted: await forgetMemory(req.currentUser!._id, kind, id),
    });
  }),
);

/**
 * GET /v1/me/speech-allowance
 *
 * INFORMATION, NOT ENFORCEMENT. The ceiling is applied server-side at reserve
 * time whatever this says; the Settings meter and the Voice ceiling screen
 * exist so somebody is told rather than surprised.
 *
 * `speechReport()` has returned exactly this shape since Phase 7 and nothing
 * called it.
 */
meRouter.get(
  "/speech-allowance",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const userId = String(req.currentUser!._id);
    const scopes = await speechUsageToday(userId);
    const mine = scopes.find((s: { scope: string }) => s.scope === `user:${userId}`);
    const used = mine?.charactersSynthesized ?? 0;

    sendData(res, speechAllowanceResponseSchema, {
      // The UTC calendar day, which is when every ceiling resets — 8pm US
      // Eastern, which is mid-evening for the people most likely to be reading.
      day: new Date().toISOString().slice(0, 10),
      scopes,
      charactersUsedToday: used,
      charactersPerDay: env.TTS_DAILY_CHARS_PER_USER,
      charactersRemaining: Math.max(0, env.TTS_DAILY_CHARS_PER_USER - used),
      voiceEnabled: env.VOICE_ENABLED,
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
