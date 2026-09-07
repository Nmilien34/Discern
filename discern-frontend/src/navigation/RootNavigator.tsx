// Routing is a switch on ACCESS STATE, not a stack the app pushes onto.
//
// Pepta's AccessGate, and the reason for the shape is the same: if the paywall
// is somewhere you navigate TO, then every screen that can hit a 402 has to
// remember to navigate there, and the one that forgets shows a blank list
// instead. Deciding at the root means there is exactly one place the question
// is asked.
//
// FOUR STATES, AND "unavailable" IS NOT "paywalled":
//
//   unknown       still asking. A spinner, not a decision.
//   active        the app.
//   paywalled     a positive no from the server. The paywall.
//   unavailable   we cannot tell. A RETRY. Never the paywall — with no free
//                 tier, that mistake locks a paying subscriber out of
//                 everything during an outage they did not cause.
//
// Onboarding is a route rather than a fifth state: it is a thing you do inside
// the app, not a reason you cannot be in it. It is reachable from the tabs once
// there is a flow worth running.

import React from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useAccess } from "../context/AccessContext";
import { useAuth } from "../context/AuthContext";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { PaywallScreen } from "../screens/PaywallScreen";
import { UnavailableScreen } from "../screens/UnavailableScreen";
import { MainTabs } from "./MainTabs";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Registration failed. Nothing works without an identity, so say so plainly. */
function RegistrationFailed(): React.JSX.Element {
  const auth = useAuth();
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>{`Could not register this device.\n\n${auth.error ?? ""}`}</Text>
      <Button title="Try again" onPress={() => void auth.register()} />
    </View>
  );
}

function Booting(): React.JSX.Element {
  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}

export function RootNavigator(): React.JSX.Element {
  const auth = useAuth();
  const access = useAccess();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {auth.loading || (auth.isAuthenticated && access.state === "unknown") ? (
          <Stack.Screen name="Booting" component={Booting} />
        ) : !auth.isAuthenticated ? (
          <Stack.Screen name="RegistrationFailed" component={RegistrationFailed} />
        ) : access.state === "paywalled" ? (
          <Stack.Screen name="Paywall" component={PaywallScreen} />
        ) : access.state === "unavailable" ? (
          // A RETRY, not a paywall. See the header of this file.
          <Stack.Screen name="Unavailable" component={UnavailableScreen} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
