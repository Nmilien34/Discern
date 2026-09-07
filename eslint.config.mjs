import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "marketing/**",
      "design/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // THE JOURNAL NEVER REACHES ABIGAIL — enforced at lint time.
  //
  // The journal moved from the phone into Mongo on 2026-09-06. It now sits in
  // the same database the retrieval pipeline reads, so the promise that it is
  // never summarised, retrieved or used as context is no longer guaranteed by
  // physics. This rule and src/tests/journal-isolation.test.ts are what replace
  // that guarantee: a prompt, retrieval or cultivation file that reaches for
  // the journal fails the gate rather than shipping.
  {
    files: [
      "discern-backend/src/services/abigail/**/*.ts",
      "discern-backend/src/services/corpus/**/*.ts",
      "discern-backend/src/services/journey/**/*.ts",
      "discern-backend/src/jobs/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/journal-entry.model", "**/journal/*", "**/journal.service"],
              message:
                "The journal never reaches Abigail: not summarised, not retrieved, " +
                "not referenced, not used as context, not embedded. If you need " +
                "this import, the feature is wrong, not the rule.",
            },
          ],
        },
      ],
    },
  },
  // Expo's own config files are CommonJS and run in Node at build time, not in
  // the app bundle. They legitimately use require/module/__dirname.
  {
    files: ["discern-frontend/*.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Expo's asset registry. `require("./x.png")` is not an import style choice —
  // it is how Metro registers a static asset and returns its numeric handle, and
  // there is no ESM equivalent. The same exemption already existed for the
  // config files above; this extends it to the one .ts file that needs it.
  //
  // Without this, `eslint .` from the repo root has 77 errors and has never been
  // clean, so the root lint has not been a usable gate. Each workspace's own
  // `npm run lint` was clean, which is how it went unnoticed.
  {
    files: ["discern-frontend/src/assets/**/*.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // The Expo app. JSX, the browser-ish globals React Native actually provides
  // (fetch, XMLHttpRequest, setTimeout, console), and `__DEV__`, which the
  // bundler injects and which is otherwise flagged as undefined.
  {
    files: ["discern-frontend/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        __DEV__: "readonly",
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
);
