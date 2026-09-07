import { defineConfig } from "vitest/config";

// The app itself needs Expo's bundler; these tests deliberately do not.
// Everything under test here is PURE — state transitions with a clock passed
// in — so it runs in plain node with no React tree and no faked AppState. The
// hook is a thin wrapper over that, which is the reason the logic lives apart
// from it.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
