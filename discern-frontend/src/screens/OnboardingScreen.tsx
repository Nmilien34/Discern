// Onboarding. Empty and routed, wired to POST /v1/me/onboarding.
//
// STEPS, NOT A BOOLEAN. The API records which steps a person has been through
// so a later onboarding change can re-run only the NEW part instead of the
// whole flow on a reinstall — and there is deliberately no endpoint to clear
// one, because onboarding is a thing that happened.
//
// The step list below is placeholder scaffolding, not the designed flow. The
// only real decision baked in is the last one: a notification time is the
// CONSENT, null is the shipped state, and null means silence. Nothing here
// asks for a time, and nothing should until someone has decided what asking
// looks like.

import React, { useCallback, useState } from "react";
import { Button, Text, View } from "react-native";

import type { OnboardingStepRecord } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError } from "../services/apiError";
import { useAccess } from "../context/AccessContext";
import { Heading, Raw, Screen } from "./Raw";

/** Placeholder identifiers. Lowercase kebab-case, which the API enforces. */
const STEPS = ["welcome", "how-she-works", "the-seven-stages", "notifications"];

export function OnboardingScreen(): React.JSX.Element {
  const access = useAccess();
  const [completed, setCompleted] = useState<OnboardingStepRecord[]>(
    access.me?.onboarding ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(async (step: string): Promise<void> => {
    setError(null);
    try {
      const result = await api.completeOnboardingStep(step);
      setCompleted(result.completed);
      console.log("[onboarding] completed", step);
    } catch (cause) {
      setError(extractApiError(cause).message);
    }
  }, []);

  const done = new Set(completed.map((s) => s.step));

  return (
    <Screen title="Onboarding (placeholder)" error={error}>
      <Text>{`${done.size} of ${STEPS.length} steps recorded`}</Text>

      <Heading>POST /v1/me/onboarding</Heading>
      {STEPS.map((step) => (
        <View key={step}>
          <Button
            title={`${done.has(step) ? "done" : "record"} — ${step}`}
            onPress={() => void complete(step)}
          />
        </View>
      ))}

      <Heading>Raw</Heading>
      <Raw value={completed} />
    </Screen>
  );
}
