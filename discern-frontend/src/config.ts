// Every value the app reads from its environment, in one place. Nothing else
// touches process.env — the backend's rule (CONVENTIONS.md §2), applied to the
// client for the same reason: a key read from three places is a key that is
// wrong in one of them.

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * The API this build talks to.
 *
 * `localhost` is the DEVELOPMENT default and is wrong on a device — a phone's
 * localhost is the phone. It works in the iOS Simulator, which shares the
 * Mac's loopback, and that is the only place it is meant to work. Set
 * EXPO_PUBLIC_API_BASE_URL for anything else.
 */
export const API_BASE_URL = withoutTrailingSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080",
);

/**
 * How long any single request may take.
 *
 * DELIBERATELY LONG, and it is not a mistake. An Abigail turn is 35-75 seconds
 * of real work — safety, premise, retrieval, several reasoning rounds — so the
 * usual 10-30 second client timeout would abort her mid-sentence and report a
 * network failure for a request that was going to succeed. Everything else on
 * the API answers in well under a second, so the long ceiling costs nothing on
 * those paths.
 */
export const REQUEST_TIMEOUT_MS = 120_000;

/** One retry on a transient failure, for idempotent reads only. */
export const RETRY_DELAY_MS = 600;
