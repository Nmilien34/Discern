// Home — the journey and the seed. Placeholder: it fetches both and prints them.
//
// The seed is PRIVATE by construction: it is computed from the append-only
// ledger on every read, there is no endpoint that returns anyone else's, and
// there is nothing here to compare against. Whatever this screen becomes, it
// does not acquire a rank, a streak, or a percentage of "done".

import React, { useCallback, useEffect, useState } from "react";
import { Button, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";

import type { CurrentStageResponse, SeedResponse } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError } from "../services/apiError";
import { Heading, Raw, Screen } from "./Raw";

export function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const [seed, setSeed] = useState<SeedResponse | null>(null);
  const [stage, setStage] = useState<CurrentStageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [seedResult, stageResult] = await Promise.all([
        api.seed(),
        api.currentStage(),
      ]);
      setSeed(seedResult);
      setStage(stageResult);
    } catch (cause) {
      setError(extractApiError(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Home — the journey and the seed" loading={loading} error={error}>
      <Button title="Reload" onPress={() => void load()} />
      {/* The onboarding route has no entry point of its own yet — the flow
          that would run it is a design decision, not a scaffold one. This is
          how it is reached until then. */}
      <Button title="Open onboarding" onPress={() => navigation.navigate("Onboarding")} />

      <Heading>GET /v1/journey/seed</Heading>
      {seed ? (
        <Text>
          {`${seed.growthStage} — ${seed.growthStageLabel}\n` +
            `${seed.points} points from ${seed.eventCount} events\n` +
            `next: ${seed.nextStage ?? "none — the arc ends, it does not loop"}`}
        </Text>
      ) : null}
      <Raw value={seed} />

      <Heading>GET /v1/journey/stage</Heading>
      <Raw value={stage} />
    </Screen>
  );
}
