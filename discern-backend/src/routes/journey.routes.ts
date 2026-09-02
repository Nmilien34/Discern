import { enterStageRequestSchema } from "@discern/shared";
import type { StageSlug } from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";
import {
  enterStage,
  getCurrentStage,
  listStages,
} from "../services/journey/stages.service";
import { computeSeed, growthArc, readLedger } from "../services/journey/seed.service";

export const journeyRouter: Router = Router();

// GATED at the router mount in app.ts, like everything else. The journey used
// to be entitlement-free on the theory that only Abigail was the paid half;
// ARCHITECTURE.md §10 decision 3 (corrected) removed that carve-out.

/** The seven stages themselves. Public config; no auth needed. */
journeyRouter.get(
  "/stages",
  asyncHandler(async (_req, res) => {
    const stages = await listStages();
    sendData(res, {
      stages: stages.map((stage) => ({
        slug: stage.slug,
        order: stage.order,
        from: stage.from,
        to: stage.to,
        description: stage.description,
        anchorPassages: stage.anchorPassages,
        openingQuestions: stage.openingQuestions,
      })),
    });
  }),
);

journeyRouter.get(
  "/stage",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(res, await getCurrentStage(req.currentUser!._id));
  }),
);

journeyRouter.post(
  "/stage",
  requireAuth,
  loadUser,
  validateBody(enterStageRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { stageSlug: StageSlug; evidence?: string };
    // Phase 5 exposes the USER path only. Abigail's path runs through
    // enterStage(..., "abigail", evidence) from her note_stage tool in Phase 6,
    // where the evidence comes from the conversation rather than the client —
    // a client that could assert "abigail said so" could fabricate a diagnosis.
    sendData(
      res,
      await enterStage(req.currentUser!._id, body.stageSlug, "user", body.evidence),
    );
  }),
);

/**
 * GET /v1/journey/seed — COMPUTED FROM THE LEDGER ON EVERY READ.
 *
 * Nothing is stored. PRIVATE by construction: it reads only the authenticated
 * user's own events, and there is deliberately no route anywhere that returns
 * another user's seed, no ranking, and nothing to compare against.
 */
journeyRouter.get(
  "/seed",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(res, await computeSeed(req.currentUser!._id));
  }),
);

/** The ledger the seed was computed from. The user's own history, nobody else's. */
journeyRouter.get(
  "/seed/ledger",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(res, {
      events: await readLedger(req.currentUser!._id),
      arc: growthArc(),
    });
  }),
);
