// Typed errors, branched on CODE and never on message text. A message is copy
// and gets rewritten; a code is the contract (ERROR_CODES in @discern/shared).
//
// THE ONE DISTINCTION THIS FILE EXISTS FOR:
//
//   402 payment_required     a POSITIVE no. Trial over, never subscribed.
//                            Show the paywall.
//   503 access_unavailable    we CANNOT TELL right now. RevenueCat is down, or
//                            reconciliation failed. Retry. NEVER a paywall.
//
// With no free tier, collapsing those two locks a PAYING SUBSCRIBER out of the
// entire product during a provider outage — not out of a premium extra, out of
// everything. `isPaywalled` below is true for exactly one code, and that is the
// whole guard.

import { ERROR_CODES, errorResponseSchema } from "@discern/shared";
import type { PaymentRequiredDetails } from "@discern/shared";
import { paymentRequiredDetailsSchema } from "@discern/shared";

/** A problem the SERVER reported, carrying its `{ code, message, details }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The server ACCEPTED the request (2xx) but its reply could not be read.
 *
 * Almost always a response shape this build predates — shipped clients bundle
 * strict zod schemas, so a widened field parses on a new build and throws on an
 * old one. Deliberately NOT an ApiError: the server reported success and the
 * client is the one that stumbled, and a caller that conflates them tells
 * someone their write failed while the record sits on the server.
 */
export class ResponseParseError extends Error {
  constructor(
    public readonly status: number,
    public readonly parseCause?: unknown,
  ) {
    super("The server answered, but its reply could not be read.");
    this.name = "ResponseParseError";
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return ERROR_CODES.validation;
    case 401:
      return ERROR_CODES.unauthorized;
    case 402:
      return ERROR_CODES.paymentRequired;
    case 403:
      return ERROR_CODES.forbidden;
    case 404:
      return ERROR_CODES.notFound;
    case 409:
      return ERROR_CODES.conflict;
    case 429:
      return ERROR_CODES.rateLimited;
    case 503:
      return ERROR_CODES.accessUnavailable;
    default:
      return ERROR_CODES.internal;
  }
}

/** Build an ApiError from a non-2xx response, preserving the error envelope. */
export async function apiErrorFrom(response: Response): Promise<ApiError> {
  let code = statusToCode(response.status);
  let message = `Discern API request failed: ${response.status}`;
  let details: unknown;

  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
      details = parsed.data.error.details;
    }
  } catch {
    // Non-JSON or empty body — keep the status-derived code and message.
  }

  return new ApiError(response.status, message, code, details);
}

/** Normalize anything thrown into a `{ code, message }` a screen can branch on. */
export function extractApiError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ResponseParseError) {
    // NOT unavailable — the service was available and did the work.
    return { code: ERROR_CODES.internal, message: error.message };
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return {
        code: ERROR_CODES.upstreamUnavailable,
        message: "That took too long. Try again.",
      };
    }
    if (error.name === "TypeError" || /network request failed|fetch/i.test(error.message)) {
      return {
        code: ERROR_CODES.upstreamUnavailable,
        message: "Could not reach Discern. Check your connection.",
      };
    }
    return { code: ERROR_CODES.internal, message: error.message };
  }
  return { code: ERROR_CODES.internal, message: "Something went wrong." };
}

/**
 * SHOW THE PAYWALL? True for exactly one code.
 *
 * Not `!hasAccess`, not "any 4xx about money", not "status >= 402". A positive
 * no is the only thing that earns a paywall.
 */
export function isPaywalled(error: unknown): boolean {
  return extractApiError(error).code === ERROR_CODES.paymentRequired;
}

/**
 * RETRY? True when the answer is "we cannot tell", never when it is "no".
 *
 * Covers both 503s — entitlement unverifiable and a model provider outage —
 * plus the offline and timeout cases, which are the same shape of problem from
 * the person's side.
 */
export function isRetryable(error: unknown): boolean {
  const { code } = extractApiError(error);
  return (
    code === ERROR_CODES.accessUnavailable ||
    code === ERROR_CODES.upstreamUnavailable
  );
}

/** Rate limiting is LIVE (30/hr, 150/day per user). Never crash on it. */
export function isRateLimited(error: unknown): boolean {
  return extractApiError(error).code === ERROR_CODES.rateLimited;
}

export function isUnauthorized(error: unknown): boolean {
  return extractApiError(error).code === ERROR_CODES.unauthorized;
}

/**
 * The 402's `details`, which is what the paywall renders from.
 *
 * `trialAvailableOn` in particular: the 7-day trial is an introductory offer on
 * ONE sku, and an app that hardcodes which one is an app that is silently wrong
 * the day the offer moves. Returns null rather than throwing — a paywall that
 * cannot parse the details should still open.
 */
export function paymentRequiredDetails(
  error: unknown,
): PaymentRequiredDetails | null {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.paymentRequired) {
    return null;
  }
  const parsed = paymentRequiredDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
