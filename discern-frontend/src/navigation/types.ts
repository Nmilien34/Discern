// The route list, so navigation is typed rather than stringly-typed.
//
// Small now on purpose. Screens are added as they are designed, and a param
// list that guesses at future routes is a param list that is wrong by the time
// they arrive.

export type RootStackParamList = {
  Booting: undefined;
  RegistrationFailed: undefined;
  Paywall: undefined;
  Unavailable: undefined;
  Tabs: undefined;
  Onboarding: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
