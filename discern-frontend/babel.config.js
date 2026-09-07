// Expo Babel config. Env vars come from EXPO_PUBLIC_* (inlined by Expo at build
// time), so no dotenv plugin is needed. Matches Pepta minus the reanimated
// plugin, which nothing here uses yet.
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
