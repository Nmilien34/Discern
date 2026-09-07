// WHETHER TO SHOW THE PAYWALL. The whole file is about one distinction.
//
// GET /v1/me returns `access: { hasAccess, paywalled }` and THEY ARE NOT
// OPPOSITES. During a RevenueCat outage both are false: we cannot confirm this
// person has access, and we also cannot say they do not. The right screen then
// is a retry, not a paywall.
//
//   hasAccess true                 open the app
//   paywalled true                 open the paywall — a POSITIVE no
//   both false                     unavailable. Retry. NEVER a paywall.
//
// With no free tier, treating "cannot verify" as "no" locks a paying
// subscriber out of the entire product. That is the failure this context
// exists to make impossible, and it is why `state` below has three values and
// not a boolean.
//
// Deliberately NOT a copy of Pepta's AccessContext. Pepta caches a bounded
// decision through an outage; Discern has no local entitlement store to cache
// from yet — RevenueCat's client SDK lands with Nick's StoreKit work — so the
// honest scaffold is: ask the server, keep three states, and retry.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { MeResponse } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError, isPaywalled, paymentRequiredDetails } from "../services/apiError";
import { useAuth } from "./AuthContext";

export type AccessState = "unknown" | "active" | "paywalled" | "unavailable";

interface AccessContextValue {
  state: AccessState;
  /** The whole profile, so screens do not each re-fetch it. */
  me: MeResponse | null;
  /** Which sku carries the 7-day trial. Never hardcode this in a screen. */
  trialAvailableOn: string | null;
  refreshing: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const AccessContext = createContext<AccessContextValue | undefined>(undefined);

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<AccessState>("unknown");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [trialAvailableOn, setTrialAvailableOn] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      const profile = await api.me();
      setMe(profile);

      // Read in this order, from the server's own two booleans. `!hasAccess` is
      // NOT the paywall condition and writing it that way is the bug.
      if (profile.access.hasAccess) setState("active");
      else if (profile.access.paywalled) setState("paywalled");
      else setState("unavailable");

      console.log(
        `[access] status=${profile.access.status} hasAccess=${profile.access.hasAccess} ` +
          `paywalled=${profile.access.paywalled} trialing=${profile.access.isTrialing}`,
      );
    } catch (cause) {
      // /v1/me is ungated, so a 402 here would be surprising — but if a gated
      // call is what surfaced the error, its details are what the paywall
      // renders from.
      if (isPaywalled(cause)) {
        setState("paywalled");
        setTrialAvailableOn(paymentRequiredDetails(cause)?.trialAvailableOn ?? null);
      } else {
        // Everything else — including offline — is "cannot tell", not "no".
        setState("unavailable");
        setError(extractApiError(cause).message);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setState("unknown");
      setMe(null);
      return;
    }
    void refresh();
  }, [auth.isAuthenticated, refresh]);

  // The trial sku comes from the products endpoint too, and this is the one
  // that works before anyone has hit a gate.
  useEffect(() => {
    void api
      .products()
      .then((products) => setTrialAvailableOn(products.trialAvailableOn))
      .catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ state, me, trialAvailableOn, refreshing, error, refresh }),
    [state, me, trialAvailableOn, refreshing, error, refresh],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext);
  if (!context) throw new Error("useAccess must be used within AccessProvider");
  return context;
}
