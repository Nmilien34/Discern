// The four tabs. Home · Bible · Carryings · Abigail.
//
// ABIGAIL SITS ON THE RIGHT, as decided. Worth writing down why, because tab
// order looks arbitrary and this one is not: the journey and the reader are
// what a person does most days, and Abigail is what they open when something
// has actually happened. Putting her first would make the app a chat app with a
// Bible attached, which is the inverse of what it is.
//
// No icons and no custom tab bar: labels only until the design system lands.

import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { AbigailScreen } from "../screens/AbigailScreen";
import { BibleScreen } from "../screens/BibleScreen";
import { CarryingsScreen } from "../screens/CarryingsScreen";
import { HomeScreen } from "../screens/HomeScreen";

const Tab = createBottomTabNavigator();

export function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bible" component={BibleScreen} />
      <Tab.Screen name="Carryings" component={CarryingsScreen} />
      <Tab.Screen name="Abigail" component={AbigailScreen} />
    </Tab.Navigator>
  );
}
