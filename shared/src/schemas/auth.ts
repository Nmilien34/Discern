// Auth, account and entitlement contracts.

import { z } from "zod";

import { ENTITLEMENT_STATUSES, LINK_PROVIDERS } from "../constants";

/**
 * POST /v1/auth/device
 *
 * The device id is generated and stored by the app. It is the primary identity
 * from first launch — ARCHITECTURE.md §10 decision 2 — so there is no signup
 * wall in front of the reader or the first conversations.
 */
export const deviceAuthRequestSchema = z
  .object({
    deviceId: z.string().min(8).max(200),
    preferences: z
      .object({
        translationId: z.string().optional(),
        notificationTime: z.string().optional(),
        voiceEnabled: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

export type DeviceAuthRequest = z.infer<typeof deviceAuthRequestSchema>;

/**
 * POST /v1/auth/link
 *
 * Attaches a durable account identity to the CURRENT device user, or merges the
 * current device user into the account that already owns that identity.
 *
 * THE CLIENT DOES NOT NAME THE ACCOUNT. It presents the provider's signed
 * identity token and the nonce it used; the server verifies the signature,
 * issuer, audience, expiry and nonce, and takes the account id from the
 * verified `sub`.
 *
 * `accountId` and `email` were request fields until 2026-09-02 and were trusted
 * as sent. An Apple `sub` is not a secret, so that let anyone who knew one be
 * merged into that person's account — and the merge moves carryings,
 * conversations, the seed ledger and memory. There is now no field in which a
 * caller can express which account to link to.
 */
export const linkAccountRequestSchema = z
  .object({
    provider: z.enum(LINK_PROVIDERS),
    /** The provider's signed JWT. Verified server-side; never decoded blindly. */
    identityToken: z.string().min(1).max(8192),
    /** The nonce this sign-in used, bound into the token by the provider. */
    nonce: z.string().min(1).max(512),
  })
  .strict();

export type LinkAccountRequest = z.infer<typeof linkAccountRequestSchema>;

export const entitlementSchema = z
  .object({
    status: z.enum(ENTITLEMENT_STATUSES),
    expiresAt: z.string().nullable(),
    willRenew: z.boolean(),
    /**
     * Three states, never a boolean.
     *
     * "verified" and "unavailable" must not collapse together: a provider outage
     * that reads as "inactive" sends a paying user to a paywall they already
     * paid at.
     */
    verificationState: z.enum(["verified", "stale", "unavailable"]),
  })
  .strict();

export type Entitlement = z.infer<typeof entitlementSchema>;

export const authResponseSchema = z
  .object({
    token: z.string(),
    userId: z.string(),
    /** True when this request created the account rather than resolving it. */
    created: z.boolean(),
  })
  .strict();

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const linkResponseSchema = z
  .object({
    token: z.string(),
    userId: z.string(),
    /**
     * What actually happened. `merged` means the device user was folded into an
     * existing account and its id is no longer the caller's identity — the app
     * MUST replace its stored token and user id with the ones returned here.
     */
    outcome: z.enum(["attached", "merged", "already-linked"]),
    /** Populated on a merge, so the client can see nothing was dropped. */
    moved: z.record(z.string(), z.number()).optional(),
  })
  .strict();

export type LinkResponse = z.infer<typeof linkResponseSchema>;

export const meResponseSchema = z
  .object({
    userId: z.string(),
    /** Null while the account is still anonymous. */
    accountId: z.string().nullable(),
    email: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    entitlement: entitlementSchema,
    currentStageSlug: z.string().nullable(),
    preferences: z
      .object({
        translationId: z.string().nullable(),
        notificationTime: z.string().nullable(),
        voiceEnabled: z.boolean(),
      })
      .strict(),
    /**
     * Whether access is live, and whether a paywall is the right thing to show.
     *
     * `hasAccess` and `paywalled` are NOT opposites, and that is deliberate:
     * during a provider outage both are false. The app must render a retry, not
     * a paywall — with no free tier, getting this wrong locks a paying
     * subscriber out of the entire product.
     */
    access: z
      .object({
        status: z.enum(ENTITLEMENT_STATUSES),
        hasAccess: z.boolean(),
        paywalled: z.boolean(),
        expiresAt: z.string().nullable(),
        isTrialing: z.boolean(),
      })
      .strict(),
    /** Analytics only. Gates nothing — there is no allowance. */
    conversationsStarted: z.number().int().nonnegative(),
  })
  .strict();

export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * PUT /v1/me/notifications
 *
 * A push token and a chosen time are SEPARATE decisions. Registering a device
 * subscribes nobody to anything; `notificationTime` is the consent, and null —
 * the shipped default — means silence.
 */
export const notificationPreferencesSchema = z
  .object({
    /** Expo/APNs token. Null clears a stale one. */
    pushToken: z.string().min(1).max(512).nullable().optional(),
    /**
     * "HH:MM", 24-hour, in the user's own zone. NULL MEANS NEVER, and null is
     * the default — there is no daily default to turn off.
     */
    notificationTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "notificationTime must be HH:MM")
      .nullable()
      .optional(),
    /** IANA zone, e.g. "America/New_York". Without it a time means nothing. */
    timezone: z.string().min(1).max(64).nullable().optional(),
    /**
     * Should Abigail's own prose be spoken to this person?
     *
     * null defers to the deployment's SPEAK_REPLIES; true and false override
     * it. This is what lets a subset of testers hear her while everyone else
     * reads her, which a deployment flag alone cannot express.
     */
    speakReplies: z.boolean().nullable().optional(),
  })
  .strict();

export type NotificationPreferencesRequest = z.infer<
  typeof notificationPreferencesSchema
>;

/**
 * POST /v1/me/onboarding
 *
 * A step identifier, not a boolean. Recording which steps are done lets a
 * later onboarding change re-run only the new part instead of the whole flow.
 */
export const onboardingStepSchema = z
  .object({
    step: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, "step must be lowercase kebab-case"),
  })
  .strict();

export type OnboardingStepRequest = z.infer<typeof onboardingStepSchema>;
