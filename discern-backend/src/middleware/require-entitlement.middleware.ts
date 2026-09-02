// THE ACCESS GATE.
//
// ARCHITECTURE.md §10 decision 3, as corrected on 2026-09-01: THERE IS NO FREE
// TIER. A 7-day trial, then a hard paywall. Reader, author navigation, journey,
// carryings and Abigail are all behind it. The only unauthenticated route in the
// app is /healthz, which is infrastructure.
//
// The previous version of this file gated Abigail on a three-conversation
// allowance and let /v1/bible through untouched. Both are gone. Entitlement is
// now the ONLY gate, which makes this file small and makes the rule easy to
// state: either RevenueCat says you have access, or you do not.
//
// TWO RESPONSES, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT:
//
//   402 payment_required     a POSITIVE "no". Trial expired, subscription
//                            lapsed, never subscribed. The app opens a paywall.
//   503 access_unavailable   we CANNOT TELL right now. A RevenueCat outage, a
//                            reconciliation failure. The app retries; it must
//                            NEVER show a paywall.
//
// That second one matters more now than it ever did. With no free tier, a
// provider outage misread as "inactive" locks a paying subscriber out of the
// entire product — not out of a premium extra, out of everything. This is the
// only thing standing between an outage and a locked-out customer.

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { PAID_ENTITLEMENT_STATUSES } from "@discern/shared";

import {
  AccessUnavailableError,
  PaymentRequiredError,
  UnauthorizedError,
} from "../lib/errors";
import type { UserDocument } from "../models";

export type AccessDecision = "active" | "inactive" | "unavailable";

/**
 * Three states, never a boolean.
 *
 * Pepta's entitlement remediation turns on this distinction: a provider outage
 * that reads as "inactive" sends a paying user to a paywall they already paid
 * at. "Cannot currently verify" is its own answer and gets its own status code.
 */
export function resolveAccess(user: UserDocument): AccessDecision {
  const { status, expiresAt, verificationState } = user.entitlement;

  if (verificationState === "unavailable") return "unavailable";

  // `trialing` is inside PAID_ENTITLEMENT_STATUSES, so the 7-day trial grants
  // full access exactly like a paid subscription. It is not a reduced mode.
  if (!PAID_ENTITLEMENT_STATUSES.includes(status as never)) return "inactive";

  // A lapsed expiry with no webhook yet is still inactive: the provider is the
  // authority on renewal, but the clock is not in dispute.
  if (expiresAt && expiresAt.getTime() < Date.now()) return "inactive";

  return "active";
}

export interface AccessView {
  status: string;
  /** True while the trial or subscription is live. */
  hasAccess: boolean;
  /** True only for a positive "no" — never during an outage. */
  paywalled: boolean;
  expiresAt: string | null;
  isTrialing: boolean;
}

export function accessViewFor(user: UserDocument): AccessView {
  const decision = resolveAccess(user);

  return {
    status: user.entitlement.status,
    hasAccess: decision === "active",
    // An outage is NOT a paywall. The app must not render one on this.
    paywalled: decision === "inactive",
    expiresAt: user.entitlement.expiresAt
      ? user.entitlement.expiresAt.toISOString()
      : null,
    isTrialing: user.entitlement.status === "trialing",
  };
}

/**
 * The gate. Mounted on every product router.
 *
 * There is no per-feature variation any more — no tiers, no allowances, no
 * free reads. One function, one rule.
 */
export function requireEntitlement(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.currentUser;

    if (!user) {
      next(new UnauthorizedError("Authentication required"));
      return;
    }

    const access = resolveAccess(user);

    if (access === "active") {
      next();
      return;
    }

    if (access === "unavailable") {
      // 503, never 402. Sending someone to a paywall because a provider is down
      // is the wrong answer to "we cannot tell right now", and with no free tier
      // it would lock a paying subscriber out of the whole app.
      next(new AccessUnavailableError());
      return;
    }

    next(
      new PaymentRequiredError(
        "Discern requires an active subscription. Start your 7-day free trial to continue.",
        {
          status: user.entitlement.status,
          reason: "no_active_entitlement",
          // The trial is an introductory offer on the ANNUAL sku only; monthly
          // charges immediately. The app needs this to render the right paywall.
          trialAvailableOn: "annual",
        },
      ),
    );
  };
}
