// Expo app config. Values that a build needs come from EXPO_PUBLIC_* env vars,
// read here so `extra` and the plugin permission strings stay in one place.
//
// NOTHING SECRET GOES IN THIS FILE. Everything under `extra` ships inside the
// bundle and is readable by anyone who downloads the app. Server-only keys —
// OpenAI, ElevenLabs, AWS, the RevenueCat secret key — never get an
// EXPO_PUBLIC_ prefix and never appear here.

const marketingVersion = "0.1.0";

const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

module.exports = {
  expo: {
    name: "Discern",
    slug: "discern",
    owner: "boltzman",
    version: marketingVersion,
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    // Fallback for anything that wants a single icon (Android, Expo Go). iOS
    // takes the three-appearance object under `ios.icon` below.
    icon: "./src/assets/icon/icon-light.png",
    ios: {
      supportsTablet: false,
      // THREE APPEARANCES, iOS 18. Do not collapse this to a single string:
      // the tinted variant is DRAWN, not derived. Tinted is a luminance map,
      // and the light art is a soft glow with no luminance structure to
      // survive the conversion — deriving it gives a pale slab.
      //
      // @expo/prebuild-config's withIosIcons renders each of these at 1024
      // into the asset catalog. It strips transparency from `light` and
      // `tinted` and flattens them onto solid white; `dark` keeps it. All
      // three files are fully opaque, so that flatten never fires — which is
      // a reason not to hand it a cross on a clear background instead.
      //
      // Regenerate with `node design/render-icon.js` after editing drawA() in
      // design/discern-shell.html. See src/assets/icon/README.md.
      icon: {
        light: "./src/assets/icon/icon-light.png",
        dark: "./src/assets/icon/icon-dark.png",
        tinted: "./src/assets/icon/icon-tinted.png",
      },
      // MUST MATCH APP STORE CONNECT AND THE BACKEND'S APPLE_BUNDLE_ID.
      //
      // Sign in with Apple verifies the identity token's `aud` against
      // APPLE_BUNDLE_ID (services/users/identity-verification.ts), so a
      // mismatch between this string and that env var fails every link
      // attempt — and it fails CLOSED, with a token that looks perfectly
      // valid. APPLE_BUNDLE_ID is currently unset on Render (DEFERRED item
      // 10), so this identifier is provisional until both are set together.
      bundleIdentifier: "ai.boltzman.discern",
      buildNumber: "1",
      usesAppleSignIn: true,
      // THE LAUNCH SCREEN — frame 0 of the brand moment, not a separate
      // picture. iOS shows this from the tap until the JS bundle is ready; our
      // own animation then starts from exactly these pixels and draws the
      // crossbar out of the beam, so there is nothing to flash at the handoff.
      //
      // This is the LEGACY `ios.splash` key on purpose. @expo/prebuild-config
      // bundles the expo-splash-screen plugin and applies it by default (no
      // dependency to install), and getIosSplashConfig sets
      // `enableFullScreenImage_legacy: true` for this key — which is what
      // makes the art fill the screen. The newer config-plugin path centres a
      // 200pt logo instead, which is not this design.
      //
      // Regenerate with `node design/render-splash.js` after editing
      // splashPaint() in design/discern-shell.html.
      splash: {
        image: "./src/assets/splash/splash.png",
        resizeMode: "cover",
        backgroundColor: "#17110C",
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Voice INPUT (POST /v1/abigail/transcribe). Declared now because the
        // client for it is scaffolded; the screen that uses it is not.
        NSMicrophoneUsageDescription:
          "Discern uses your microphone so you can speak to Abigail instead of typing.",
      },
    },
    android: {
      package: "ai.boltzman.discern",
      permissions: ["android.permission.RECORD_AUDIO"],
    },
    plugins: ["expo-secure-store"],
    extra: {
      apiBaseUrl,
    },
  },
};
