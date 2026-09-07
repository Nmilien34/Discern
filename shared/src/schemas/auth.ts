// Auth, account and entitlement contracts.

import { z } from "zod";

import {
  ENTITLEMENT_STATUSES,
  GROWTH_STAGES,
  LINK_PROVIDERS,
  ONBOARDING_BROUGHT,
  ONBOARDING_FAMILIARITY,
  ONBOARDING_TIME_AVAILABLE,
  STAGE_SLUGS,
  TYPE_SIZES,
} from "../constants";

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

/**
 * WHAT SOMEONE SAID DURING ONBOARDING.
 *
 * ── THESE ARE PRODUCT DATA. THEY ARE NOT JOURNAL DATA. ──────────────────────
 *
 * The next person to read this will reasonably wonder, because both are things
 * a person typed about themselves and one of them never leaves. So, explicitly:
 *
 *   The JOURNAL is what someone writes for themselves. It never reaches
 *   Abigail — not summarised, not retrieved, not referenced, not embedded — and
 *   that is enforced by a lint rule, a models barrel that will not export it,
 *   and a test written before the feature.
 *
 *   ONBOARDING ANSWERS are what someone told the product in order to be given
 *   the right thing. They MAY inform the path, the starting virtue, and
 *   Abigail's context — that is what they are for, and screen 9 says so out
 *   loud: "She will have it when you talk."
 *
 * The journal's rules do not extend here and were never meant to. What DOES
 * extend is that these are sensitive: round 15 ruled the vice selection
 * sensitive, so it is listed under "what she remembers", it is deletable there,
 * and it goes in the privacy policy.
 *
 * EVERY FIELD IS OPTIONAL because answers accumulate. Someone who quits at
 * screen 9 and comes back does not start over, so each screen writes what it
 * has and nothing waits for the end.
 */
export const onboardingAnswersSchema = z
  .object({
    /** Screen 3. The highest-value field here: Home's greeting and the wall. */
    name: z.string().min(1).max(80).nullable().optional(),
    /** Screen 4. */
    brought: z.enum(ONBOARDING_BROUGHT).nullable().optional(),
    /**
     * Screen 6, pick any. STAGE SLUGS, not vice words, because that is what
     * `resolveStartingStage()` already takes.
     */
    vices: z.array(z.enum(STAGE_SLUGS)).max(7).optional(),
    /** Screen 7, asked only when more than one was chosen. */
    firstVice: z.enum(STAGE_SLUGS).nullable().optional(),
    /** Screen 9. Free text, optional, and visibly so. */
    situation: z.string().max(4000).nullable().optional(),
    /** Screen 10. A first name, or whatever they call them. */
    person: z.string().max(120).nullable().optional(),
    /** Screen 12. */
    familiarity: z.enum(ONBOARDING_FAMILIARITY).nullable().optional(),
    /** Screen 14. */
    timeAvailable: z.enum(ONBOARDING_TIME_AVAILABLE).nullable().optional(),
  })
  .strict();

export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

/**
 * One completed onboarding step, as the API returns it.
 *
 * ADDED 2026-09-04, AT THE PHASE 9 GATE, BECAUSE IT WAS MISSING AND THAT WAS A
 * REAL BREAK. `meResponseSchema` is strict and did not declare `onboarding` or
 * three of the six preference fields the route has been sending since Phase 8,
 * so the first client to parse GET /v1/me against this contract would have
 * thrown on a perfectly healthy response. The contract existing is not the same
 * as the contract being right; nothing was checking it against the route.
 */
export const onboardingStepRecordSchema = z
  .object({ step: z.string(), completedAt: z.string() })
  .strict();

export type OnboardingStepRecord = z.infer<typeof onboardingStepRecordSchema>;

/**
 * What the reader has chosen. Every field is nullable-or-default because every
 * one of them is a decision nobody has made yet on first launch.
 *
 * `pushRegistered` is a BOOLEAN, not the token: the app never needs the token
 * back and sending it would be handing a credential to every client that asks
 * for its own profile.
 */
export const userPreferencesSchema = z
  .object({
    translationId: z.string().nullable(),
    /** "HH:MM" in `timezone`. NULL MEANS NEVER, and null is the shipped state. */
    notificationTime: z.string().nullable(),
    timezone: z.string().nullable(),
    pushRegistered: z.boolean(),
    /** null defers to the deployment's SPEAK_REPLIES. */
    speakReplies: z.boolean().nullable(),
    voiceEnabled: z.boolean(),
    /**
     * Reader type size. Round 14: the reader is the most-used screen and
     * people's eyes differ. Settings writes it; nothing else reads it yet.
     */
    typeSize: z.enum(TYPE_SIZES),
  })
  .strict();

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

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
    /**
     * What she calls them. Asked on onboarding screen 3 — "participating by
     * screen three" — and rendered by Home's greeting and the paywall.
     */
    name: z.string().nullable(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    entitlement: entitlementSchema,
    currentStageSlug: z.string().nullable(),
    /**
     * The tree's stage, and its label, ON THE IDENTITY RESPONSE.
     *
     * Settings opens with the glyph and "Sapling, at the fourth of six", and
     * Settings is the screen with RESTORE PURCHASES on it — so the person most
     * likely to open it is a lapsed subscriber, who by definition cannot call
     * the entitlement-gated `GET /v1/journey/seed`. Two strings here rather
     * than a 402 on the header of the screen someone opened to resubscribe.
     *
     * Points, the ledger and the contributions stay behind the wall. This is
     * the minimum that makes the screen renderable, not the seed in miniature.
     */
    growthStage: z.enum(GROWTH_STAGES),
    growthStageLabel: z.string(),
    /**
     * The steps this person has already been through.
     *
     * Sent so a reinstall re-runs only what is NEW rather than the whole flow —
     * which is the reason onboarding is recorded as step identifiers and not as
     * a boolean (see onboardingStepSchema).
     */
    onboarding: z.array(onboardingStepRecordSchema),
    /**
     * What they said during onboarding. Empty until they answer something.
     *
     * On the identity response rather than behind the entitlement gate,
     * because the greeting and the paywall line both need the name and both
     * happen before anybody has paid.
     */
    onboardingAnswers: onboardingAnswersSchema,
    preferences: userPreferencesSchema,
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
    /**
     * WHAT THEY SAID ON THIS SCREEN, if anything.
     *
     * Sent alongside the step so one call per screen records both "they got
     * here" and "here is the answer". That is what makes resume work: someone
     * who quits at screen 9 has nine screens of answers stored, not zero, and
     * nothing waits for a final submit that may never come.
     *
     * Merged into what is already there, never replacing it — a later screen
     * cannot clear an earlier answer by omitting it.
     */
    answers: onboardingAnswersSchema.optional(),
    step: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, "step must be lowercase kebab-case"),
  })
  .strict();

export type OnboardingStepRequest = z.infer<typeof onboardingStepSchema>;

/**
 * PUT /v1/me/notifications, response.
 *
 * `willNotify` is said back EXPLICITLY rather than left for the client to infer
 * from the other two, because the inference is exactly the mistake this route
 * is shaped to prevent: registering a push token subscribes nobody to anything,
 * and a client that assumes it did will tell someone they have a reminder set
 * when they have not.
 */
export const notificationPreferencesResponseSchema = z
  .object({
    pushRegistered: z.boolean(),
    notificationTime: z.string().nullable(),
    timezone: z.string().nullable(),
    willNotify: z.boolean(),
    speakReplies: z.boolean().nullable(),
  })
  .strict();

export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;

/** POST /v1/me/onboarding, response — the full set, not just the new step. */
/* ── ACCOUNT DELETION ──────────────────────────────────────────────────────
 *
 * RE-AUTHENTICATION IS REQUIRED, and a valid session token is not it. A phone
 * left unlocked on a table already carries a valid session; the destructive
 * action needs proof that the person is present right now.
 *
 * Which proof depends on what the account is:
 *   linked     the provider's signed token again, whose subject must match the
 *              account already on file
 *   anonymous  the device id, because there is no provider to assert against
 *              and holding the device is the strongest claim available
 *
 * Anonymous deletion has to work. Someone who purchased before signing up and
 * never finished has real data under an anonymous id, and telling them to
 * create an account before they can delete one is absurd.
 */
export const deleteAccountRequestSchema = z
  .union([
    z
      .object({
        confirm: z.literal("DELETE"),
        provider: z.enum(LINK_PROVIDERS),
        identityToken: z.string().min(1).max(8192),
        nonce: z.string().min(1).max(512),
      })
      .strict(),
    z
      .object({
        confirm: z.literal("DELETE"),
        deviceId: z.string().min(8).max(200),
      })
      .strict(),
  ]);

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const deleteAccountResponseSchema = z
  .object({
    deletedAt: z.string(),
    /** label -> rows removed or anonymised, from the registry walk. */
    removed: z.record(z.string(), z.number().int().nonnegative()),
    /** What was anonymised rather than deleted, and why, in plain words. */
    retained: z.array(
      z.object({ collection: z.string(), reason: z.string() }).strict(),
    ),
    /**
     * ALWAYS TRUE, and it is here so the client cannot forget it.
     *
     * Deleting the account does NOT cancel the subscription. Apple owns the
     * subscription; we own the account. Somebody who deletes expecting billing
     * to stop gets charged again, asks for a refund, and leaves one star — so
     * the flow offers cancellation FIRST and this field is the contract's
     * reminder that the two are separate systems.
     */
    subscriptionUnaffected: z.literal(true),
  })
  .strict();

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

export const onboardingResponseSchema = z
  .object({
    completed: z.array(onboardingStepRecordSchema),
    /**
     * Everything stored so far, said back.
     *
     * So a client resuming at screen 9 can render what it already has rather
     * than asking again, and so a write is confirmable without a second round
     * trip to `GET /v1/me`.
     */
    answers: onboardingAnswersSchema,
  })
  .strict();

export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;


/**
 * PATCH /v1/me/preferences.
 *
 * Settings and onboarding screen 13 write the same fields, so they share one
 * endpoint. `PUT /v1/me/notifications` stays separate: a push token and a
 * chosen time are a different decision with a different failure mode, and
 * merging them would mean a translation change could clear a push token.
 */
export const updatePreferencesRequestSchema = z
  .object({
    translationId: z.string().min(1).max(64).optional(),
    typeSize: z.enum(TYPE_SIZES).optional(),
    voiceEnabled: z.boolean().optional(),
    speakReplies: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one preference must be given",
  });

export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

export const preferencesResponseSchema = z
  .object({ preferences: userPreferencesSchema })
  .strict();

export type PreferencesResponse = z.infer<typeof preferencesResponseSchema>;
