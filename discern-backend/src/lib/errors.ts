// Error classes. Ported from Pepta's shape via Corner: a code, an HTTP status,
// optional structured details, and an `expose` flag deciding whether the message
// is safe to send to a client. CONVENTIONS.md §3.

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly expose: boolean;

  public constructor(
    code: string,
    message: string,
    statusCode = 500,
    details?: unknown,
    expose = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.expose = expose;
  }
}

export class ValidationError extends AppError {
  public constructor(message = "Request validation failed", details?: unknown) {
    super("validation_error", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = "Authentication required") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = "Not permitted") {
    super("forbidden", message, 403);
  }
}

export class NotFoundError extends AppError {
  public constructor(message = "Resource not found") {
    super("not_found", message, 404);
  }
}

/**
 * THE PAYWALL RESPONSE. The only one.
 *
 * 402 rather than 403 so the app can distinguish "buy this" from "you may never
 * have this" — only 402 should open a paywall. ARCHITECTURE.md §10 decision 3
 * (corrected 2026-09-01) removed the free tier entirely, so this is the response
 * for EVERY product route when the trial has not started or has ended.
 *
 * Note what it is not: 503 access_unavailable means we could not verify, and
 * must never render a paywall. Collapsing the two locks paying subscribers out
 * of the whole product during a provider outage.
 */
export class PaymentRequiredError extends AppError {
  public constructor(
    message = "This feature requires an active subscription",
    details?: unknown,
  ) {
    super("payment_required", message, 402, details);
  }
}

// QuotaExceededError was deleted on 2026-09-01. There is no quota: no free
// tier, no allowance, nothing metered. PaymentRequiredError (402) is the ONLY
// paywall response, and having exactly one removes the question of which to use.

export class ConflictError extends AppError {
  public constructor(message = "Conflict", details?: unknown) {
    super("conflict", message, 409, details);
  }
}

export class RateLimitedError extends AppError {
  public constructor(message = "Too many requests", details?: unknown) {
    super("rate_limited", message, 429, details);
  }
}

/**
 * Access could not be verified right now — distinct from a positive "no".
 *
 * Pepta's entitlement remediation turns on this distinction: a provider outage
 * must not downgrade a paying user to inactive. 503 tells the client to retry,
 * where a 402 would send them to a paywall they already paid at.
 */
export class AccessUnavailableError extends AppError {
  public constructor(message = "Access verification temporarily unavailable") {
    super("access_unavailable", message, 503, undefined, true);
  }
}

/**
 * A reasoning model spent its entire token budget thinking and emitted nothing.
 *
 * `max_completion_tokens` on a reasoning model budgets reasoning tokens AND
 * visible output. When reasoning consumes it, the API returns
 * `finish_reason: "length"` with EMPTY content and NO ERROR — a 200 response
 * carrying nothing.
 *
 * This is named because the symptom points nowhere near the cause. It looks like
 * a prompt problem, a model problem, or a parsing bug.
 *
 * DISCERN WILL MEET THIS HARDER THAN CORNER DID. Every Phase 6 reasoning turn
 * carries retrieved passages, user memory, the last N turns and the premise
 * pass's output into one long prompt, and the grounding check then regenerates
 * on failure — so a budget sized for the answer alone is consumed before a
 * single visible token appears, twice. Raise maxTokens; it is not a prompt
 * problem.
 */
export class ReasoningBudgetExhaustedError extends AppError {
  public constructor(details: {
    model: string;
    maxTokens: number;
    reasoningTokens?: number;
    completionTokens?: number;
  }) {
    super(
      "reasoning_budget_exhausted",
      `Model "${details.model}" returned empty content with finish_reason="length". ` +
        `Its reasoning consumed the whole ${details.maxTokens}-token budget before producing output. ` +
        "Raise maxTokens — this is not a prompt problem.",
      502,
      details,
      true,
    );
  }
}

export class InternalError extends AppError {
  public constructor(message = "Internal server error", details?: unknown) {
    super("internal_error", message, 500, details, false);
  }
}

export class NotImplementedError extends AppError {
  public constructor(message = "Not implemented") {
    super("not_implemented", message, 501, undefined, true);
  }
}
