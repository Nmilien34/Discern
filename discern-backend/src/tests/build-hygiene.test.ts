// A deleted source file must not leave a compiled ghost behind.
//
// `tsc -p tsconfig.json` EMITS; it does not clean. So a file removed from src/
// keeps its .js and .d.ts in dist/ indefinitely, and because package.json's
// `main` and `exports` point into dist, a consumer can still import and RUN it.
//
// This is not hypothetical. `shared/dist/schemas/proposed/` was still being
// published after the source was deleted in FIX 05, and a sweep on 2026-09-06
// found two more: `shared/dist/auth/tokens.js` — a compiled copy of the JWT
// issuer, requiring paths that no longer exist inside that package — and
// `discern-backend/dist/scripts/_premise-check.js`. Both were reachable.
//
// The fix is a `clean` step in front of every build. This test is what stops it
// being removed later by someone tidying up npm scripts.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..", "..");

describe("every build cleans dist first", () => {
  for (const pkg of ["shared", "discern-backend"]) {
    it(`${pkg}'s build removes dist before emitting`, () => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(ROOT, pkg, "package.json"), "utf8"),
      ) as { scripts?: Record<string, string> };

      const build = manifest.scripts?.build ?? "";
      const clean = manifest.scripts?.clean ?? "";

      expect(build, `${pkg} has no build script`).not.toBe("");
      expect(build, `${pkg} builds without cleaning first`).toContain("clean");
      // Actually removes the directory, rather than a clean script that has
      // been quietly emptied out.
      expect(clean).toMatch(/rmSync|rimraf|rm -rf/);
      expect(clean).toContain("dist");
    });
  }
});
