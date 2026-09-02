// RevenueCat webhook handling.
//
// Ported from Pepta's implementation via Corner's CONVENTIONS.md, which lists
// the properties that matter. Each one below is here because its absence was a
// real bug somewhere:
//
//   FAIL CLOSED         no secret configured -> 503, never "process it anyway".
//                       Leanient skipped verification when unset; that is the
//                       one thing from the references not to copy.
//   TIMING-SAFE         constant-time comparison, both header forms accepted.
//   EVENT WHITELIST     only listed types may mutate entitlement. The previous
//                       shape elsewhere was a chain of ifs ending in "free",
//                       which turned every event RevenueCat invents — PAUSED,
//                       EXTENDED, TEST — into a DOWNGRADE.
//   RECEIPT LAST        the receipt proves processing COMPLETED. Written first,
//                       it would mark a half-applied event as done and the
//                       provider's retry would skip it.
//   ALIAS-AWARE LOOKUP  a device-first app has several app-user ids per person.
//   NO TRANSFER POISON  transferred_from ids are not stored on the winner, or a
//                       later loser event downgrades them.

import { timingSafeEqual } from "node:crypto";

import type { EntitlementStatus } from "@discern/shared";
import { z } from "zod";

import { env } from "../../config/env";
import { AccessUnavailableError, ForbiddenError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { ProcessedWebhookEventModel, UserModel } from "../../models";

/**
 * Provider payload. Deliberately permissive about ids being null — RevenueCat
 * sends nulls for several of these depending on event type — and forward
 * compatible about `type`, which is validated against the whitelist instead.
 */
export const revenueCatWebhookSchema = z.object({
  api_version: z.string().optional(),
  event: z.object({
    id: z.string(),
    type: z.string(),
    app_user_id: z.string().nullable().optional(),
    original_app_user_id: z.string().nullable().optional(),
    aliases: z.array(z.string()).nullable().optional(),
    transferred_from: z.array(z.string()).nullable().optional(),
    transferred_to: z.array(z.string()).nullable().optional(),
    product_id: z.string().nullable().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    period_type: z.string().nullable().optional(),
    purchased_at_ms: z.number().nullable().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    store: z.string().nullable().optional(),
    environment: z.string().nullable().optional(),
    transaction_id: z.string().nullable().optional(),
    price_in_purchased_currency: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    cancel_reason: z.string().nullable().optional(),
  }),
});

export type RevenueCatWebhook = z.infer<typeof revenueCatWebhookSchema>;

/**
 * THE ONLY EVENT TYPES ALLOWED TO CHANGE ENTITLEMENT.
 *
 * Anything not listed is acknowledged, receipted, and changes nothing. That is
 * the safe default: an unknown event means "we do not know what this is", and
 * the correct response to not knowing is to leave a paying customer alone.
 */
const ENTITLEMENT_EVENTS: Record<string, EntitlementStatus> = {
  INITIAL_PURCHASE: "active",
  RENEWAL: "active",
  PRODUCT_CHANGE: "active",
  UNCANCELLATION: "active",
  SUBSCRIPTION_PAUSED: "active_canceled",
  CANCELLATION: "active_canceled",
  BILLING_ISSUE: "past_due",
  EXPIRATION: "expired",
  SUBSCRIPTION_EXTENDED: "active",
};

/**
 * Trial purchases are `trialing`, not a paid conversion.
 *
 * `trialing` grants FULL access — the 7-day trial is not a reduced mode, it is
 * the product. It should only ever arrive for the ANNUAL sku: the trial is an
 * introductory offer on that product in App Store Connect, not on the
 * subscription group, and monthly charges immediately. A TRIAL period_type on a
 * monthly purchase means the offer was configured in the wrong place, so it is
 * logged rather than silently honoured.
 */
function statusFor(event: RevenueCatWebhook["event"]): EntitlementStatus | null {
  const base = ENTITLEMENT_EVENTS[event.type];
  if (!base) return null;

  const isTrial = (event.period_type ?? "").toUpperCase() === "TRIAL";

  if (isTrial) {
    // Both SKUs live in one subscription group, so a single entitlement is
    // resolved either way — but only the annual product should carry a trial.
    const product = (event.product_id ?? "").toLowerCase();
    if (product && !product.includes("annual") && !product.includes("year")) {
      logger.warn(
        { productId: event.product_id, eventType: event.type },
        "TRIAL period on a non-annual product — the introductory offer is " +
          "configured on the wrong SKU or on the subscription group",
      );
    }

    if (base === "active" || base === "active_canceled") return "trialing";
  }

  return base;
}

/**
 * Constant-time shared-secret check. Accepts a bearer token or the dedicated
 * header, matching both reference apps.
 */
export function verifyRevenueCatSecret(headerValue: string | undefined): void {
  const expected = env.REVENUECAT_WEBHOOK_SECRET;

  if (!expected) {
    // Should be unreachable: the key is required at boot from Phase 4. Kept as
    // a fail-closed backstop rather than a silent accept.
    throw new AccessUnavailableError(
      "RevenueCat webhook secret is not configured.",
    );
  }

  const token = headerValue?.startsWith("Bearer ")
    ? headerValue.slice("Bearer ".length)
    : headerValue;

  const provided = Buffer.from(token ?? "");
  const wanted = Buffer.from(expected);

  // Length is compared first because timingSafeEqual throws on a mismatch. The
  // length leak is not meaningful; a thrown exception reaching the error handler
  // as a 500 would be.
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new ForbiddenError("Invalid RevenueCat webhook secret.");
  }
}

/** Every id this event could identify a user by, EXCLUDING transferred_from. */
function candidateAppUserIds(event: RevenueCatWebhook["event"]): string[] {
  const ids = [
    event.app_user_id,
    event.original_app_user_id,
    ...(event.aliases ?? []),
  ].filter((id): id is string => Boolean(id));

  return [...new Set(ids)];
}

/**
 * A placeholder id is not evidence of a customer.
 *
 * RevenueCat's anonymous ids look like `$RCAnonymousID:...`. Storing one as a
 * durable customer identifier makes later reconciliation lookups create a
 * customer on read.
 */
function isUsableAppUserId(id: string): boolean {
  return id.length > 0 && !id.startsWith("$RCAnonymousID:");
}

export interface WebhookResult {
  received: true;
  duplicate: boolean;
  mutatedEntitlement: boolean;
  userFound: boolean;
}

export async function applyRevenueCatWebhook(
  payload: RevenueCatWebhook,
): Promise<WebhookResult> {
  const { event } = payload;

  // Idempotency check FIRST — but note the receipt is only WRITTEN at the end.
  // A retry of an event that failed halfway finds no receipt and re-applies.
  const existing = await ProcessedWebhookEventModel.findOne({
    provider: "revenuecat",
    eventId: event.id,
  });

  if (existing) {
    logger.info(
      { eventId: event.id, eventType: event.type },
      "revenuecat event already processed, acknowledging",
    );
    return {
      received: true,
      duplicate: true,
      mutatedEntitlement: false,
      userFound: existing.userId !== null,
    };
  }

  const candidates = candidateAppUserIds(event);

  const user = candidates.length
    ? await UserModel.findOne({
        $or: [
          { "entitlement.revenueCatAppUserIds": { $in: candidates } },
          { _id: { $in: candidates.filter((id) => /^[0-9a-fA-F]{24}$/.test(id)) } },
        ],
      })
    : null;

  const status = statusFor(event);
  let mutated = false;

  if (user && status) {
    // Stale-downgrade protection: an EXPIRATION that arrives after a RENEWAL has
    // already extended the period must not revoke access.
    const incomingExpiry = event.expiration_at_ms
      ? new Date(event.expiration_at_ms)
      : null;
    const currentExpiry = user.entitlement.expiresAt;

    const isDowngrade = status === "expired" || status === "past_due";
    const currentIsLater =
      currentExpiry !== null &&
      incomingExpiry !== null &&
      currentExpiry.getTime() > incomingExpiry.getTime();

    if (isDowngrade && currentIsLater) {
      logger.warn(
        {
          eventId: event.id,
          eventType: event.type,
          userId: String(user._id),
        },
        "ignoring stale downgrade: stored expiry is later than the event's",
      );
    } else {
      user.entitlement.status = status;
      user.entitlement.expiresAt = incomingExpiry;
      user.entitlement.willRenew = status === "active" || status === "trialing";
      user.entitlement.lastVerifiedAt = new Date();
      user.entitlement.verificationState = "verified";
      mutated = true;
    }

    // Union the usable ids so a later event under any alias still finds them.
    // transferred_from is excluded by candidateAppUserIds by construction.
    const usable = candidates.filter(isUsableAppUserId);
    user.entitlement.revenueCatAppUserIds = [
      ...new Set([...user.entitlement.revenueCatAppUserIds, ...usable]),
    ];
    if (!user.entitlement.revenueCatId && usable[0]) {
      user.entitlement.revenueCatId = usable[0];
    }

    await user.save();
  } else if (user && !status) {
    logger.info(
      { eventId: event.id, eventType: event.type, userId: String(user._id) },
      "revenuecat event type is not in the entitlement whitelist, no-op",
    );
  } else {
    // An event naming nobody is retained as a receipt rather than dropped: the
    // purchase is real even if the local user is not yet linked.
    logger.warn(
      { eventId: event.id, eventType: event.type, candidates },
      "revenuecat event did not match a known user; retaining receipt",
    );
  }

  // RECEIPT LAST.
  try {
    await ProcessedWebhookEventModel.create({
      provider: "revenuecat",
      eventId: event.id,
      eventType: event.type,
      userId: user?._id ?? null,
      appUserId: event.app_user_id ?? null,
      revenueCatCustomerId: event.original_app_user_id ?? null,
      productId: event.product_id ?? null,
      transactionId: event.transaction_id ?? null,
      environment: event.environment ?? null,
      store: event.store ?? null,
      periodType: event.period_type ?? null,
      priceInPurchasedCurrency: event.price_in_purchased_currency ?? null,
      currency: event.currency ?? null,
      mutatedEntitlement: mutated,
    });
  } catch (error) {
    // A duplicate key here means a concurrent delivery won the race and the work
    // is done. Acknowledge rather than asking the provider to retry.
    if ((error as { code?: number }).code === 11000) {
      logger.info(
        { eventId: event.id },
        "concurrent delivery already receipted this event",
      );
      return {
        received: true,
        duplicate: true,
        mutatedEntitlement: mutated,
        userFound: Boolean(user),
      };
    }
    throw error;
  }

  return {
    received: true,
    duplicate: false,
    mutatedEntitlement: mutated,
    userFound: Boolean(user),
  };
}
