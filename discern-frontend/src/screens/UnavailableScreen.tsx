// "We cannot tell right now." NOT the paywall.
//
// This is the screen a 503 gets — access_unavailable, or a dropped connection.
// It exists as its own route because the alternative is reusing the paywall for
// it, and that is precisely the failure the three-state access model is built
// to prevent: with no free tier, showing a paywall to someone whose entitlement
// merely could not be verified locks a paying subscriber out of the entire
// product during an outage they did not cause.
//
// So: a retry, and nothing to buy.

import React from "react";
import { Button, Text } from "react-native";

import { useAccess } from "../context/AccessContext";
import { Screen } from "./Raw";

export function UnavailableScreen(): React.JSX.Element {
  const access = useAccess();

  return (
    <Screen title="Discern is not reachable" error={access.error}>
      <Text>
        Your subscription could not be checked just now. This is not a paywall —
        nothing about your access has changed.
      </Text>
      <Text>{`access state: ${access.state}`}</Text>
      <Button
        title={access.refreshing ? "Checking…" : "Try again"}
        onPress={() => void access.refresh()}
        disabled={access.refreshing}
      />
    </Screen>
  );
}
