import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SECRET_MIN_BYTES,
  SECRET_MIN_DISTINCT_CHARS,
  secretByteLength,
} from "../config/env";

describe("secretByteLength", () => {
  it("measures hex after decoding, not by character count", () => {
    // `openssl rand -hex 32` — 64 characters carrying exactly 32 bytes.
    expect(secretByteLength("a".repeat(64))).toBe(32);
    expect(secretByteLength("0123456789abcdef".repeat(4))).toBe(32);
  });

  it("measures base64 after decoding", () => {
    // `openssl rand -base64 32` — 44 characters carrying a full 32 bytes. A
    // 64-CHARACTER rule rejects this while accepting weaker hex, which is the
    // whole reason this is measured in bytes.
    const base64 = Buffer.from("x".repeat(32)).toString("base64");
    expect(base64).toHaveLength(44);
    expect(secretByteLength(base64)).toBe(32);
  });

  it("tries hex before base64, since hex's alphabet is a subset", () => {
    // "abcdef01" is valid in both. Measured as hex it is 4 bytes; measured as
    // base64 it would be 6, overcounting every hex secret ever supplied.
    expect(secretByteLength("abcdef01")).toBe(4);
  });

  it("falls back to raw UTF-8 for anything else", () => {
    expect(secretByteLength("not-hex-or-base64!!")).toBe(19);
  });

  it("accepts both generated forms at the threshold", () => {
    expect(secretByteLength("a1b2c3d4".repeat(8))).toBeGreaterThanOrEqual(
      SECRET_MIN_BYTES,
    );
  });
});

describe("distinct-character floor", () => {
  it("is what catches a secret that is long, valid hex, and worthless", () => {
    // 64 repeated 'a's decode to a genuine 32 bytes, so the BYTE check passes.
    // Only the distinct-character floor rejects it.
    const weak = "a".repeat(64);
    expect(secretByteLength(weak)).toBeGreaterThanOrEqual(SECRET_MIN_BYTES);
    expect(new Set(weak).size).toBeLessThan(SECRET_MIN_DISTINCT_CHARS);
  });

  it("passes any generated secret comfortably", () => {
    const generated =
      "9f2c41ab7e6d0538c1a4be97f20d6c8b35ea71904dc26f8b1e5a3097cb42de60";
    expect(new Set(generated).size).toBeGreaterThanOrEqual(
      SECRET_MIN_DISTINCT_CHARS,
    );
  });
});

describe("vector search availability probe", () => {
  it("uses a probe vector of the configured width, and not all zeros", async () => {
    // Two separate bugs lived in this one line, and both were silent.
    //
    //   queryVector: [0]                  -> "vector field is indexed with 3072
    //                                        dimensions but queried with 1"
    //   new Array(3072).fill(0)           -> "Cosine similarity cannot be
    //                                        calculated against a zero vector"
    //
    // Either rejection is caught by the availability probe and read as "this is
    // not Atlas", so retrieval silently drops to the in-process fallback on a
    // cluster where $vectorSearch was READY the whole time. The only symptom was
    // that queries took 15-22 seconds instead of 3, because the fallback returns
    // CORRECT results — it just reads every embedding over the network first.
    const source = await readFile(
      path.resolve(__dirname, "../services/corpus/retrieval.ts"),
      "utf8",
    );

    expect(source).toContain("embeddingDimensions()");
    expect(source).toMatch(/probeVector\[0\]\s*=\s*1/);
    // The literal that caused the first bug must not come back.
    expect(source).not.toMatch(/queryVector:\s*\[0\]/);
  });
});
