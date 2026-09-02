// Request/response contracts shared by the API and the app.
//
// CONVENTIONS.md §1: public contracts live here, not in route-local schema
// files. Provider-private payload schemas (RevenueCat webhooks, OpenAI tool
// arguments) may stay next to their adapter — they are never a client contract.

import { z } from "zod";

import { HEALTH_STATUSES } from "../constants";

export * from "./auth";
export * from "./bible";
export * from "./journey";

/**
 * GET /healthz.
 *
 * `commit` and `service` are part of the CONTRACT, not debug extras. Corner's
 * API and worker drifted on 2026-08-28 — the worker ran current code while the
 * web service served a build two commits earlier — and three separate times in
 * one day something looked healthy while not being current. Both Discern
 * processes report this same shape so they can be compared directly.
 */
export const healthResponseSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  database: z.boolean(),
  service: z.string(),
  commit: z.string(),
  startedAt: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Every failure body in the API. CONVENTIONS.md §3. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
