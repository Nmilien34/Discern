import pino from "pino";

import { env } from "../config/env";

/**
 * Structured JSON logs with an ISO timestamp and a `service` base field,
 * matching Pepta and Corner so all three backends aggregate the same way.
 *
 * Use `logger.child({ ... })` for per-unit context. The worker does this per
 * job; the Abigail pipeline should do it per turn (Phase 6) so safety, premise,
 * reasoning and grounding all share one correlation ID.
 */
// `service` is a BASE field, so it must not be repeated in a call's payload.
// Pino APPENDS child bindings and per-call fields to base rather than merging
// over them, so `logger.child({ service })` or `logger.info({ service })` emits
// the key TWICE and produces a record an aggregator parses ambiguously. That is
// why the identity is resolved once, here, and why entry points log their build
// info without a `service` field.
//
// Precedence: Render sets RENDER_SERVICE_NAME correctly per service, so it wins
// on a deploy. SERVICE_NAME covers local runs, set by the worker's npm scripts —
// without it the worker's output is indistinguishable from the API's.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.RENDER_SERVICE_NAME ?? env.SERVICE_NAME ?? "discern-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
