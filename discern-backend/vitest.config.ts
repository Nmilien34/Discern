import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    // Runs before the test module graph is imported, so config/env.ts validates
    // against these values and never against a developer's real .env.
    setupFiles: ["./src/tests/setup-env.ts"],
  },
});
