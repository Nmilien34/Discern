// THE JOURNAL NEVER REACHES ABIGAIL.
//
// While the journal was on the phone this was guaranteed by physics. It is now
// a collection in the same database the retrieval pipeline reads, and the only
// thing between them is discipline — so the guarantee is written down as tests
// and as a lint rule, and it was written BEFORE the feature.
//
// Three properties, weakest to strongest:
//
//   1. no journal text reaches the prompt builder
//   2. no journal document is embedded or indexed for vector search
//   3. the retrieval, prompt and cultivation services do not import the
//      journal model AT ALL — transitively
//
// (3) is the one that matters, because it fails in the gate rather than in
// production, and because it cannot be satisfied by remembering to be careful.
// It is held in three places, and each closes a hole the others leave:
//
//   models/index.ts       SIDE-EFFECT IMPORTS the journal and does NOT re-export
//                         it, so `import { JournalEntryModel } from "../models"`
//                         is a TYPE ERROR. This is the compile-time half.
//   eslint.config.mjs     no-restricted-imports bans the direct path from
//                         services/abigail, services/corpus, services/journey
//                         and jobs. This is the lint-time half.
//   this file             the transitive graph, plus the assertions that the
//                         other two are still armed.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");

/** Everything that builds what Abigail sees, or what search can reach. */
const FORBIDDEN_ROOTS = [
  "services/abigail/prompt.ts",
  "services/abigail/pipeline.ts",
  "services/abigail/premise.ts",
  "services/abigail/grounding.ts",
  "services/abigail/tools.ts",
  "services/corpus/retrieval.ts",
  "services/corpus/embeddings.ts",
  "services/corpus/enrichment.ts",
  "services/corpus/query-rewrite.ts",
  "services/journey/availability.service.ts",
  "services/journey/stages.service.ts",
  "services/journey/seed.service.ts",
  "jobs/memory-summary.ts",
];

/** Anything that is, or reads, the journal. */
const JOURNAL_FILES = [
  "models/journal-entry.model.ts",
  "services/journal/journal.service.ts",
];

/**
 * Code only.
 *
 * The comments in the journal model explain at length that there is no
 * embedding field, and a naive grep for "embedding" therefore fails on the very
 * documentation of the rule. Same trap the price sweep hit.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readIfPresent(file: string): string | null {
  const full = path.join(SRC, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

/** Relative imports only — a package import cannot reach the journal. */
function importsOf(file: string): string[] {
  const source = readIfPresent(file);
  if (source === null) return [];
  const dir = path.dirname(file);
  const out: string[] = [];
  const re = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const target = path.normalize(path.join(dir, m[1]!));
    for (const candidate of [`${target}.ts`, path.join(target, "index.ts")]) {
      if (!fs.existsSync(path.join(SRC, candidate))) continue;
      // models/index.ts imports the journal FOR SIDE EFFECT ONLY — so that
      // db/connect.ts:syncIndexes() sees its indexes at boot — and does not
      // re-export it. That edge is registration, not a data path, and the
      // "barrel does not re-export" test below is what keeps it that way.
      if (file === "models/index.ts" && candidate === "models/journal-entry.model.ts") break;
      out.push(candidate);
      break;
    }
  }
  return out;
}

/** Every file reachable from `root` by relative import, transitively. */
function reachableFrom(root: string): Set<string> {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file));
  }
  seen.delete(root);
  return seen;
}

describe("the journal never reaches Abigail", () => {
  it("the roots this test guards all exist — so a rename cannot silently disarm it", () => {
    const missing = FORBIDDEN_ROOTS.filter((f) => readIfPresent(f) === null);
    expect(missing).toEqual([]);
  });

  it("the barrel registers the journal without re-exporting it", () => {
    // THE COMPILE-TIME HALF. Every other model is `export * from "./x.model"`.
    // The journal is a bare `import "./journal-entry.model"`, so the symbol is
    // not reachable through the registry and reaching for it there does not
    // compile. If this ever becomes an `export *`, the guarantee is gone.
    const barrel = readIfPresent("models/index.ts") ?? "";
    expect(barrel).toContain('import "./journal-entry.model"');
    expect(barrel).not.toMatch(/export \* from "\.\/journal-entry\.model"/);
  });

  it("the lint rule that bans the direct import is still armed", () => {
    // THE LINT-TIME HALF. A rule that is silently deleted is worse than no
    // rule, because the tests around it still pass.
    const config = fs.readFileSync(path.join(SRC, "..", "..", "eslint.config.mjs"), "utf8");
    expect(config).toContain("no-restricted-imports");
    expect(config).toContain("**/journal-entry.model");
    for (const dir of ["services/abigail", "services/corpus", "services/journey", "jobs"]) {
      expect(config).toContain(`discern-backend/src/${dir}/**/*.ts`);
    }
  });

  it("no prompt, retrieval or cultivation code imports the journal, transitively", () => {
    const violations: string[] = [];
    for (const root of FORBIDDEN_ROOTS) {
      const reachable = reachableFrom(root);
      for (const journalFile of JOURNAL_FILES) {
        if (reachable.has(journalFile)) violations.push(`${root} → ${journalFile}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("nothing outside the journal's own files names the journal model", () => {
    const allowed = new Set([
      ...JOURNAL_FILES,
      "models/index.ts",
      "routes/journal.routes.ts",
      // The registry is the point: one list, walked by merge and by deletion.
      "services/users/account-link.service.ts",
      "tests/journal-isolation.test.ts",
      "tests/journal.test.ts",
      "tests/client-claims.test.ts",
      "tests/account-deletion.test.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        if (allowed.has(rel)) continue;
        if (/JournalEntryModel|JournalEntryDocument/.test(fs.readFileSync(path.join(SRC, rel), "utf8"))) {
          offenders.push(rel);
        }
      }
    };
    walk(".");
    expect(offenders).toEqual([]);
  });

  it("the journal is not embedded and not indexed for vector search", () => {
    // The two embedding fields the corpus uses. If either ever appears on the
    // journal model, the entry body is one $vectorSearch away from being
    // retrievable — which is the failure this whole file exists to prevent.
    const model = readIfPresent("models/journal-entry.model.ts");
    expect(model, "the journal model is missing").not.toBeNull();
    const code = stripComments(model!);
    expect(code).not.toMatch(/embedding/i);
    expect(code).not.toMatch(/vectorSearch|knnBeta|\$vector/i);

    // And no aggregation anywhere in the journal's own code reaches for the
    // vector index — the model having no field is not enough if the service
    // could join to one.
    const service = stripComments(readIfPresent("services/journal/journal.service.ts") ?? "");
    expect(service).not.toMatch(/embedding|vectorSearch|\$lookup/i);
  });

  it("no journal text is ever passed to the prompt builder", () => {
    // Structural, not textual: the prompt builder's inputs are typed, and none
    // of those types is the journal's. Asserted by absence of the identifier in
    // every file that contributes to a prompt.
    for (const root of FORBIDDEN_ROOTS) {
      const source = readIfPresent(root) ?? "";
      expect.soft(source, `${root} names the journal`).not.toMatch(/journalEntr|JournalEntr/);
    }
  });
});
