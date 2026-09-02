// PROVIDER IDENTITY VERIFICATION.
//
// THE HOLE THIS CLOSES. Until 2026-09-02, POST /v1/auth/link took `accountId`
// straight from the request body and trusted it. An Apple `sub` is not a secret
// — every app a person signs into receives it — so anyone who learned one could
// post it and be merged into that account. The merge reparents carryings,
// conversations, the seed ledger and user memory, so the practical effect was a
// stranger reading what someone told Abigail.
//
// The rule now: THE CLIENT NEVER NAMES THE ACCOUNT. It presents a signed token
// from the provider, this module verifies it, and the account id is whatever the
// verified `sub` says it is. A caller cannot express "link me to user B" because
// there is no field in which to say it.
//
// Verification is deliberately strict and fails closed. Every check below has a
// specific attack behind it:
//
//   signature   forged or unsigned tokens ("alg": "none" is the classic)
//   issuer      a token minted by some other identity provider
//   audience    a real Apple token issued to a DIFFERENT app — without this,
//               any developer's app could mint tokens that work here
//   expiry      a replayed token from a captured session
//   nonce       a token captured from one sign-in replayed into another

import crypto from "node:crypto";

import jwt from "jsonwebtoken";
import type { LinkProvider } from "@discern/shared";

import { env } from "../../config/env";
import { UnauthorizedError } from "../../lib/errors";
import { logger } from "../../lib/logger";

export interface VerifiedIdentity {
  /** The provider's stable subject. THE ONLY acceptable source of accountId. */
  subject: string;
  /** Only set when the provider says it is verified. */
  email: string | null;
}

interface Jwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/**
 * JWKS cache.
 *
 * Apple rotates signing keys, so this cannot be fetched once at boot and kept
 * forever; it also must not be fetched on every sign-in. Ten minutes, and a
 * cache miss on an unknown `kid` forces an immediate refetch so a rotation is
 * picked up within one request rather than within ten minutes.
 */
const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<Jwk[]> {
  const response = await fetch(APPLE_JWKS_URL);

  if (!response.ok) {
    throw new Error(`Apple JWKS returned ${response.status}`);
  }

  const body = (await response.json()) as { keys?: Jwk[] };

  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("Apple JWKS contained no keys");
  }

  return body.keys;
}

async function appleKeyFor(kid: string): Promise<crypto.KeyObject> {
  const fresh =
    jwksCache !== null && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;

  if (!fresh) {
    jwksCache = { keys: await fetchJwks(), fetchedAt: Date.now() };
  }

  let jwk = jwksCache?.keys.find((k) => k.kid === kid);

  // Unknown kid on a cached set means Apple rotated. Refetch once before
  // deciding the token is bad — otherwise every sign-in fails for up to the
  // cache TTL after a rotation.
  if (!jwk && fresh) {
    jwksCache = { keys: await fetchJwks(), fetchedAt: Date.now() };
    jwk = jwksCache.keys.find((k) => k.kid === kid);
  }

  if (!jwk) {
    throw new UnauthorizedError("Identity token was not signed by a known key.");
  }

  // Node imports a JWK directly, so no PEM conversion and no extra dependency.
  return crypto.createPublicKey({
    key: jwk as unknown as crypto.JsonWebKey,
    format: "jwk",
  });
}

/**
 * Does `presented` match the token's nonce claim?
 *
 * Apple carries whatever the client put in the authorization request. iOS apps
 * conventionally send SHA256(raw) and keep the raw value, so both forms are
 * accepted — either way the caller has to know the nonce that was used, which is
 * what stops a captured token being replayed into a different sign-in.
 */
function nonceMatches(claim: string, presented: string): boolean {
  const hashed = crypto.createHash("sha256").update(presented).digest("hex");

  const equal = (a: string, b: string): boolean => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  };

  return equal(claim, presented) || equal(claim, hashed);
}

async function verifyApple(
  identityToken: string,
  nonce: string,
): Promise<VerifiedIdentity> {
  if (!env.APPLE_BUNDLE_ID) {
    // Fail closed. Without an audience to check against, a valid Apple token
    // issued to ANY other app would verify here.
    throw new Error(
      "APPLE_BUNDLE_ID is not set. Sign in with Apple cannot be verified " +
        "without an audience to check the token against, and accepting one " +
        "unchecked would let any app's token link an account here.",
    );
  }

  const decoded = jwt.decode(identityToken, { complete: true });

  if (!decoded || typeof decoded === "string" || !decoded.header.kid) {
    throw new UnauthorizedError("Identity token is malformed.");
  }

  const key = await appleKeyFor(decoded.header.kid);

  let claims: jwt.JwtPayload;

  try {
    claims = jwt.verify(identityToken, key, {
      // PINNED. Without this, a token with "alg":"none" or an HS256 token
      // signed with the public key as its secret would be accepted.
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      audience: env.APPLE_BUNDLE_ID,
    }) as jwt.JwtPayload;
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "apple identity token rejected",
    );
    throw new UnauthorizedError("Identity token is not valid.");
  }

  if (!claims.sub) {
    throw new UnauthorizedError("Identity token carries no subject.");
  }

  const claimedNonce = typeof claims.nonce === "string" ? claims.nonce : null;

  if (!claimedNonce || !nonceMatches(claimedNonce, nonce)) {
    throw new UnauthorizedError(
      "Identity token nonce does not match this sign-in.",
    );
  }

  // Apple reports email_verified as a boolean or the string "true".
  const verified =
    claims.email_verified === true || claims.email_verified === "true";

  return {
    subject: claims.sub,
    email: verified && typeof claims.email === "string" ? claims.email : null,
  };
}

/**
 * Verify a provider identity token and return the subject to link.
 *
 * Providers other than Apple throw rather than falling through. A provider this
 * module cannot verify must not be linkable, because "unverified" and
 * "unsupported" reaching the same place is exactly the bug being fixed.
 */
export async function verifyIdentityToken(
  provider: LinkProvider,
  identityToken: string,
  nonce: string,
): Promise<VerifiedIdentity> {
  if (provider === "apple") return verifyApple(identityToken, nonce);

  throw new UnauthorizedError(
    `Sign-in with ${provider} is not supported yet. Only Apple identity ` +
      "tokens can be verified, and an unverified identity is not accepted.",
  );
}

/** Test seam: drops the cached JWKS so a stubbed fetch is honoured. */
export function resetJwksCacheForTests(): void {
  jwksCache = null;
}
