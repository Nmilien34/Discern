// The paywall. Empty and routed, wired to the endpoints, rendering raw values.
//
// TWO THINGS THIS SCREEN MUST NEVER DO, and they are both easier to get wrong
// than to get right:
//
// 1. NO PRICES IN THE APP OR FROM THE SERVER. GET /v1/billing/products returns
//    identifiers. The real price comes from StoreKit, which is why
//    localization, currency and regional pricing are automatically correct and
//    why a number typed here would be right on day one and wrong forever
//    after. There is no price in this file and there must never be one.
//
// 2. NEVER RENDER FROM `!hasAccess`. This screen is shown only when the server
//    said `paywalled: true` — a positive no. During a RevenueCat outage both
//    hasAccess and paywalled are false, and the right screen is the retry in
//    UnavailableScreen, not this one.
//
// `trialAvailableOn` decides which sku gets the "start free trial" affordance.
// It is read from the API rather than hardcoded to "annual", because the day
// that offer moves is the day a hardcoded app starts lying about it.

import React, { useEffect, useState } from "react";
import { Button, Text } from "react-native";

import type { ProductsResponse } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError } from "../services/apiError";
import { useAccess } from "../context/AccessContext";
import { Heading, Raw, Screen } from "./Raw";

export function PaywallScreen(): React.JSX.Element {
  const access = useAccess();
  const [products, setProducts] = useState<ProductsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .products()
      .then(setProducts)
      .catch((cause: unknown) => setError(extractApiError(cause).message));
  }, []);

  return (
    <Screen title="Paywall (placeholder)" error={error}>
      <Text>
        {`access state: ${access.state} · status: ${access.me?.access.status ?? "?"}`}
      </Text>
      <Text>{`trial available on: ${access.trialAvailableOn ?? products?.trialAvailableOn ?? "?"}`}</Text>

      <Heading>GET /v1/billing/products — identifiers, no prices</Heading>
      {products?.stores.apple.map((product) => (
        <Text key={product.id}>
          {`${product.id} · ${product.period}` +
            (product.hasIntroductoryOffer ? " · 7-day trial" : " · charges immediately")}
        </Text>
      ))}
      <Raw value={products} />

      <Heading>Purchase</Heading>
      <Text>
        StoreKit is not wired up. RevenueCat lands with Nick&apos;s work; this
        button only re-checks whether access has become live.
      </Text>
      <Button title="Re-check access" onPress={() => void access.refresh()} />
    </Screen>
  );
}
