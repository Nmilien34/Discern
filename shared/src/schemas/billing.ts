// What is for sale, as IDENTIFIERS. THE SERVER NEVER STATES A PRICE.
//
// There is no `price` field in this file and there must never be one. The
// client resolves the real price from StoreKit, so localization, currency,
// regional pricing and any change made in App Store Connect are automatically
// correct. A price in this contract could only ever be a second copy of the
// truth, and the copy is the one that goes stale — right in the code and wrong
// on the screen.

import { z } from "zod";

export const SUBSCRIPTION_PERIODS = ["annual", "monthly"] as const;

export const subscriptionPeriodSchema = z.enum(SUBSCRIPTION_PERIODS);

export type SubscriptionPeriod = z.infer<typeof subscriptionPeriodSchema>;

export const storeProductSchema = z
  .object({
    /** The store's product identifier. The app hands this to StoreKit. */
    id: z.string(),
    period: subscriptionPeriodSchema,
    /**
     * The 7-day trial is an introductory offer on the ANNUAL sku only; monthly
     * charges immediately. The paywall needs this to put "start free trial"
     * against the right one.
     */
    hasIntroductoryOffer: z.boolean(),
    displayOrder: z.number().int(),
  })
  .strict();

export type StoreProduct = z.infer<typeof storeProductSchema>;

/**
 * GET /v1/billing/products
 *
 * Grouped BY STORE rather than returned as a flat list, so adding Google Play
 * later is a new key rather than a breaking change to every shipped client.
 * `google` is absent until configured — not an empty array pretending the store
 * exists.
 */
export const productsResponseSchema = z
  .object({
    stores: z
      .object({
        apple: z.array(storeProductSchema),
        google: z.array(storeProductSchema).optional(),
      })
      .strict(),
    /**
     * Both SKUs sit in ONE subscription group, so the provider resolves a
     * single entitlement and a person moving between them does not end up
     * holding two.
     */
    singleSubscriptionGroup: z.boolean(),
    trialAvailableOn: subscriptionPeriodSchema,
  })
  .strict();

export type ProductsResponse = z.infer<typeof productsResponseSchema>;

/**
 * The `details` on a 402.
 *
 * The paywall is rendered from THIS, not from the message string. In
 * particular `trialAvailableOn` decides which sku gets the trial affordance,
 * and hardcoding "annual" in the app is how that silently becomes wrong the
 * day the offer moves.
 */
/**
 * POST /v1/billing/webhook
 *
 * Was a hand-written `WebhookResult` interface in the billing service — the
 * exact thing this package exists to prevent: a second definition of a response
 * shape, free to drift from what the client expects. RevenueCat does not read
 * this body, but our own tests and any future console do.
 */
export const webhookResponseSchema = z
  .object({
    received: z.literal(true),
    /** The event id had already been receipted. Nothing was re-applied. */
    duplicate: z.boolean(),
    mutatedEntitlement: z.boolean(),
    /** False when the event named an app user id this deployment cannot resolve. */
    userFound: z.boolean(),
  })
  .strict();

export type WebhookResponse = z.infer<typeof webhookResponseSchema>;

/**
 * The `details` on a 402. STRICT since 2026-09-06.
 *
 * It was `.passthrough()` AND unused — the middleware built the object as a
 * literal, so this schema described a shape nothing checked. Both halves are
 * fixed: it is strict, and `require-entitlement.middleware.ts` now types its
 * literal as `PaymentRequiredDetails`, so the two cannot drift apart without
 * failing to compile.
 */
export const paymentRequiredDetailsSchema = z
  .object({
    status: z.string(),
    reason: z.string(),
    trialAvailableOn: subscriptionPeriodSchema,
  })
  .strict();

export type PaymentRequiredDetails = z.infer<
  typeof paymentRequiredDetailsSchema
>;
