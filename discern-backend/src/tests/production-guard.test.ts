// The guard on the loaded gun.
//
// Two things are tested, and the second matters more than the first.
//
// 1. The decision itself: production + no flag = refused.
// 2. THAT EVERY WRITING SCRIPT ACTUALLY CALLS IT. A guard one script forgets is
//    not a guard, it is a guard-shaped comfort. This walks src/scripts, finds
//    every file containing a write operation, and asserts it imports the guard.
//    A twelfth script inherits the protection by failing this test rather than
//    by somebody remembering.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_DB_NAME,
  PRODUCTION_OVERRIDE_FLAG,
  productionWriteRefusal,
} from "../lib/production-guard";

const WRITE_OPS =
  /\b(deleteMany|deleteOne|updateMany|updateOne|insertMany|insertOne|bulkWrite|dropDatabase|findOneAndUpdate|findOneAndDelete)\b|Model\.create\(|\.save\(\)/;

const SCRIPTS = path.join(__dirname, "..", "scripts");

describe("production write guard", () => {
  it("refuses a write to the production database with no flag", () => {
    const refusal = productionWriteRefusal("segment-passages.ts", PRODUCTION_DB_NAME, []);
    expect(refusal).not.toBeNull();
    // The database NAME is in the message. "Refused" on its own leaves somebody
    // guessing at the exact moment they should not be.
    expect(refusal).toContain(PRODUCTION_DB_NAME);
    expect(refusal).toContain("segment-passages.ts");
    expect(refusal).toContain(PRODUCTION_OVERRIDE_FLAG);
  });

  it("allows it when the flag is typed on that run", () => {
    expect(
      productionWriteRefusal("segment-passages.ts", PRODUCTION_DB_NAME, [
        PRODUCTION_OVERRIDE_FLAG,
      ]),
    ).toBeNull();
  });

  it("does not stand in the way of any other database", () => {
    for (const db of ["discern-test", "discern_dev", "discern-opscheck"]) {
      expect(productionWriteRefusal("seed-corpus.ts", db, [])).toBeNull();
    }
  });

  it("is not satisfiable by an environment variable", () => {
    // The flag is read from argv, never from env. An env var set once and
    // forgotten leaves every later run unguarded, which is the original hazard
    // with a delay on it.
    const source = fs.readFileSync(
      path.join(__dirname, "..", "lib", "production-guard.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/process\.env/);
  });

  it("EVERY script that writes imports the guard", () => {
    const unguarded = fs
      .readdirSync(SCRIPTS)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => WRITE_OPS.test(fs.readFileSync(path.join(SCRIPTS, f), "utf8")))
      .filter((f) => !fs.readFileSync(path.join(SCRIPTS, f), "utf8").includes("assertWritable"));

    expect(unguarded).toEqual([]);
  });

  it("finds the writers it claims to find", () => {
    // Guards the guard: if the write-op pattern ever stops matching, the test
    // above would pass by finding nothing at all.
    const writers = fs
      .readdirSync(SCRIPTS)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => WRITE_OPS.test(fs.readFileSync(path.join(SCRIPTS, f), "utf8")));

    expect(writers.length).toBeGreaterThanOrEqual(11);
    expect(writers).toContain("segment-passages.ts");
  });
});
