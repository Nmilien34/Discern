// SIGN IN WITH APPLE — TOKEN VERIFICATION.
//
// The hole these cover: /v1/auth/link used to take `accountId` from the request
// body and trust it. An Apple `sub` is not a secret, so anyone who learned one
// could post it and be merged into that person's account — carryings,
// conversations, seed ledger, and everything they told Abigail.
//
// These are property tests on the verifier, not on the transport. Each one
// corresponds to a specific forgery, and every case that is NOT a token Apple
// actually signed for THIS app and THIS sign-in must throw.

import crypto from "node:crypto";

import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetJwksCacheForTests,
  verifyIdentityToken,
} from "../services/users/identity-verification";

const BUNDLE_ID = "com.boltzman.discern";
const ISSUER = "https://appleid.apple.com";
const KID = "test-key-1";

// A stand-in for Apple's signing key. The test serves its PUBLIC half as the
// JWKS, so the verifier follows exactly the path it does in production.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

/** A DIFFERENT key, for tokens that are well-formed but not Apple's. */
const attacker = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwksFor(key: crypto.KeyObject, kid = KID): unknown {
  return { keys: [{ ...key.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" }] };
}

function sign(
  claims: Record<string, unknown>,
  key: crypto.KeyObject = privateKey,
  header: Record<string, unknown> = {},
): string {
  return jwt.sign(claims, key.export({ type: "pkcs8", format: "pem" }) as string, {
    algorithm: "RS256",
    keyid: KID,
    ...header,
  });
}

const NONCE = "nonce-from-this-sign-in";
const HASHED = crypto.createHash("sha256").update(NONCE).digest("hex");

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: BUNDLE_ID,
    sub: "000123.userA.4242",
    nonce: HASHED,
    email: "a@example.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function serveJwks(key: crypto.KeyObject = publicKey, kid = KID): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => jwksFor(key, kid) }) as never,
    ),
  );
}

beforeEach(() => {
  // BUNDLE_ID matches what setup-env.ts put in place before config/env.ts was
  // imported. env is parsed once at import and frozen, so it cannot be changed
  // here — which is the point of that design, and why the "unset" case below
  // has to isolate the module instead.
  resetJwksCacheForTests();
  serveJwks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetJwksCacheForTests();
});

describe("verifyIdentityToken — Apple", () => {
  it("accepts a token Apple signed for this app and this sign-in", async () => {
    const identity = await verifyIdentityToken("apple", sign(validClaims()), NONCE);

    expect(identity.subject).toBe("000123.userA.4242");
    expect(identity.email).toBe("a@example.com");
  });

  it("accepts the RAW nonce as well as its sha256, since iOS apps send either", async () => {
    const token = sign(validClaims({ nonce: NONCE }));
    await expect(verifyIdentityToken("apple", token, NONCE)).resolves.toMatchObject({
      subject: "000123.userA.4242",
    });
  });

  // ---- Forgeries ----------------------------------------------------------

  it("REJECTS an unsigned token (alg: none)", async () => {
    // The classic JWT forgery: strip the signature and claim no algorithm.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: KID })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(validClaims())).toString("base64url");

    await expect(
      verifyIdentityToken("apple", `${header}.${payload}.`, NONCE),
    ).rejects.toThrow(/not valid|malformed/i);
  });

  it("REJECTS a token signed with someone else's key", async () => {
    const token = sign(validClaims(), attacker.privateKey);
    await expect(verifyIdentityToken("apple", token, NONCE)).rejects.toThrow(/not valid/i);
  });

  it("REJECTS a token whose kid is not in Apple's JWKS", async () => {
    serveJwks(publicKey, "some-other-kid");
    await expect(
      verifyIdentityToken("apple", sign(validClaims()), NONCE),
    ).rejects.toThrow(/known key/i);
  });

  it("REJECTS a real Apple token issued to a DIFFERENT app", async () => {
    // Without the audience check, any developer's Apple token would link here.
    const token = sign(validClaims({ aud: "com.someone.else" }));
    await expect(verifyIdentityToken("apple", token, NONCE)).rejects.toThrow(/not valid/i);
  });

  it("REJECTS a token from a different issuer", async () => {
    const token = sign(validClaims({ iss: "https://accounts.google.com" }));
    await expect(verifyIdentityToken("apple", token, NONCE)).rejects.toThrow(/not valid/i);
  });

  it("REJECTS an expired token", async () => {
    const token = sign(validClaims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    await expect(verifyIdentityToken("apple", token, NONCE)).rejects.toThrow(/not valid/i);
  });

  it("REJECTS a token replayed from a different sign-in", async () => {
    // Right signature, right app, right user — wrong nonce. This is the check
    // that stops a token captured elsewhere being reused here.
    const token = sign(validClaims());
    await expect(
      verifyIdentityToken("apple", token, "a-different-nonce"),
    ).rejects.toThrow(/nonce/i);
  });

  it("REJECTS a token carrying no nonce at all", async () => {
    const claims = validClaims();
    delete claims.nonce;
    await expect(verifyIdentityToken("apple", sign(claims), NONCE)).rejects.toThrow(/nonce/i);
  });

  it("REFUSES to verify when APPLE_BUNDLE_ID is unset", async () => {
    // Fail closed: with no audience to check, a real Apple token issued to any
    // other app would verify here. env is frozen at import, so this needs a
    // fresh module graph with the value mocked away.
    vi.resetModules();
    vi.doMock("../config/env", async (orig) => {
      const actual = (await orig()) as { env: Record<string, unknown> };
      return { ...actual, env: { ...actual.env, APPLE_BUNDLE_ID: undefined } };
    });

    const isolated = await import("../services/users/identity-verification");
    isolated.resetJwksCacheForTests();

    await expect(
      isolated.verifyIdentityToken("apple", sign(validClaims()), NONCE),
    ).rejects.toThrow(/APPLE_BUNDLE_ID/);

    vi.doUnmock("../config/env");
    vi.resetModules();
  });

  it("does not return an unverified email", async () => {
    const token = sign(validClaims({ email_verified: false }));
    const identity = await verifyIdentityToken("apple", token, NONCE);
    expect(identity.email).toBeNull();
  });

  // ---- The attack this whole file exists for ------------------------------

  it("A VALID TOKEN FOR USER A CANNOT NAME USER B", async () => {
    // The old hole: accountId came from the request body, so an attacker
    // holding their OWN valid Apple token could simply claim user B's sub.
    //
    // Now the subject is read from the signed token and nothing else. There is
    // no argument, field, or override through which user B can be requested —
    // the verifier's entire output for A's token is A.
    const tokenForA = sign(validClaims({ sub: "000123.userA.4242" }));
    const identity = await verifyIdentityToken("apple", tokenForA, NONCE);

    expect(identity.subject).toBe("000123.userA.4242");
    expect(identity.subject).not.toBe("000999.userB.7777");

    // And a token that merely CLAIMS to be B, signed by anyone but Apple, dies.
    const forgedForB = sign(validClaims({ sub: "000999.userB.7777" }), attacker.privateKey);
    await expect(verifyIdentityToken("apple", forgedForB, NONCE)).rejects.toThrow(/not valid/i);
  });

  it("REFUSES providers it cannot verify rather than trusting them", async () => {
    // "Unsupported" and "unverified" must not reach the same place.
    await expect(
      verifyIdentityToken("google", sign(validClaims()), NONCE),
    ).rejects.toThrow(/not supported/i);
  });
});
