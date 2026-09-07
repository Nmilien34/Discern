// The only shared "component" in the scaffold, and it is not a design decision.
//
// Phase 9 is scaffolding: the job is to prove the wire works, not to decide
// what anything looks like. So every screen renders its data as raw values
// through this, and when the design system lands these are the call sites that
// get replaced — one per screen, obvious, with nothing to unpick.
//
// The `monospace` font family is the one exception to "do not style anything",
// and it is there to make JSON legible rather than to look like anything.

import React from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function Raw({ value }: { value: unknown }): React.JSX.Element {
  return (
    <Text style={{ fontFamily: "Courier", fontSize: 11 }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </Text>
  );
}

export function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text style={{ fontWeight: "bold", marginBottom: 8 }}>{children}</Text>;
}

/**
 * The three states every screen in here has: loading, failed, and data.
 *
 * `error` is rendered rather than swallowed on purpose — a scaffold whose
 * screens go blank when a request fails cannot be used to verify anything, and
 * a blank screen is exactly what a 402 looked like before the paywall existed.
 */
export function Screen({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading?: boolean;
  error?: string | null;
  children?: React.ReactNode;
}): React.JSX.Element {
  // Inset, not styling: without it the first line renders under the status bar
  // and the screenshot that is supposed to verify a value shows half of one.
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 48,
      }}
    >
      <Heading>{title}</Heading>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text>{`ERROR: ${error}`}</Text> : null}
      <View>{children}</View>
    </ScrollView>
  );
}
