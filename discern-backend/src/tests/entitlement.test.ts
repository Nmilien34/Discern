// The access gate, after the free tier was removed.
//
// The 503 path is the one that matters most here and had NO coverage before
// this file. With no free tier, misreading a provider outage as "inactive"
// does not downgrade someone to a lesser mode — it locks a paying subscriber
// out of the entire product. This is the only thing standing between a
// RevenueCat outage and a locked-out customer, so it is tested as a property
// rather than trusted to a comment.

import { describe, expect, it } from "vitest";

import { AppError } from "../lib/errors";
import type { UserDocument } from "../models";
import {
  accessViewFor,
  requireEntitlement,
  resolveAccess,
} from "../middleware/require-entitlement.middleware";

type Entitlement = UserDocument["entitlement"];

function userWith(entitlement: Partial<Entitlement>): UserDocument {
  return {
    entitlement: {
      status: "free",
      expiresAt: null,
      willRenew: false,
      revenueCatAppUserIds: [],
      lastVerifiedAt: null,
      verificationState: "verified",
      ...entitlement,
    },
  } as UserDocument;
}

/** Runs the middleware and returns whatever it passed to next(). */
function gate(user: UserDocument | undefined): unknown {
  let passed: unknown = "NOT_CALLED";
  requireEntitlement()(
    { currentUser: user } as never,
    {} as never,
    ((error?: unknown) => {
      passed = error ?? null;
    }) as never,
  );
  return passed;
}

describe("resolveAccess", () => {
  it("grants access while trialing — the trial is the product, not a lesser mode", () => {
    expect(resolveAccess(userWith({ status: "trialing" }))).toBe("active");
  });

  it("grants access when active or active_canceled", () => {
    expect(resolveAccess(userWith({ status: "active" }))).toBe("active");
    // Cancelled but not yet expired: they paid for this period.
    expect(resolveAccess(userWith({ status: "active_canceled" }))).toBe("active");
  });

  it("refuses when nobody has ever subscribed", () => {
    // There is no free tier, so `free` means no access at all.
    expect(resolveAccess(userWith({ status: "free" }))).toBe("inactive");
  });

  it("refuses when the period has lapsed, even if the status still says active", () => {
    expect(
      resolveAccess(
        userWith({ status: "active", expiresAt: new Date(Date.now() - 1000) }),
      ),
    ).toBe("inactive");
  });

  it("reports UNAVAILABLE — not inactive — when verification failed", () => {
    // The whole point. A provider outage is not a positive "no".
    expect(
      resolveAccess(
        userWith({ status: "active", verificationState: "unavailable" }),
      ),
    ).toBe("unavailable");
  });

  it("keeps a lapsed-but-unverifiable user unavailable rather than inactive", () => {
    // Even with an expired date, "we cannot check" wins: the renewal webhook may
    // simply be the thing that is failing to arrive.
    expect(
      resolveAccess(
        userWith({
          status: "active",
          expiresAt: new Date(Date.now() - 86_400_000),
          verificationState: "unavailable",
        }),
      ),
    ).toBe("unavailable");
  });
});

describe("requireEntitlement", () => {
  it("lets an active subscriber through", () => {
    expect(gate(userWith({ status: "active" }))).toBeNull();
  });

  it("lets a trialing user through", () => {
    expect(gate(userWith({ status: "trialing" }))).toBeNull();
  });

  it("returns 402 payment_required — the ONLY paywall response", () => {
    const error = gate(userWith({ status: "expired" })) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(402);
    expect(error.code).toBe("payment_required");
    // quota_exceeded was deleted with the free tier; nothing should emit it.
    expect(error.code).not.toBe("quota_exceeded");
  });

  it("tells the app the trial is on the annual product", () => {
    const error = gate(userWith({ status: "free" })) as AppError;
    expect(JSON.stringify(error.details)).toContain("annual");
  });

  it("RETURNS 503, NOT 402, WHEN VERIFICATION IS UNAVAILABLE", () => {
    // The single most important assertion in this file. A 402 here sends a
    // paying subscriber to a paywall they already paid at, during an outage
    // that is not their fault, with no free tier to fall back to.
    const error = gate(
      userWith({ status: "active", verificationState: "unavailable" }),
    ) as AppError;

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe("access_unavailable");
    expect(error.statusCode).not.toBe(402);
  });

  it("requires authentication before it can decide anything", () => {
    const error = gate(undefined) as AppError;
    expect(error.statusCode).toBe(401);
  });
});

describe("accessViewFor", () => {
  it("does NOT treat hasAccess and paywalled as opposites during an outage", () => {
    // Both false. The app must render a retry, not a paywall — an app that
    // computes `paywalled = !hasAccess` reintroduces the exact bug the
    // three-state design exists to prevent.
    const view = accessViewFor(
      userWith({ status: "active", verificationState: "unavailable" }),
    );

    expect(view.hasAccess).toBe(false);
    expect(view.paywalled).toBe(false);
  });

  it("marks a genuinely lapsed subscriber as paywalled", () => {
    const view = accessViewFor(userWith({ status: "expired" }));
    expect(view.hasAccess).toBe(false);
    expect(view.paywalled).toBe(true);
  });

  it("flags a trialing subscriber so the app can show days remaining", () => {
    const view = accessViewFor(userWith({ status: "trialing" }));
    expect(view.isTrialing).toBe(true);
    expect(view.hasAccess).toBe(true);
    expect(view.paywalled).toBe(false);
  });
});
