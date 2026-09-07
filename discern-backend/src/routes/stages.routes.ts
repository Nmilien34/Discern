import {
  stagesListResponseSchema,
} from "@discern/shared";
// The seven, and whether each has content.
//
// UNGATED, deliberately. Onboarding screen 6 shows all seven vices and screen 7
// offers only the ones with published reads — and both run BEFORE the paywall.
// Behind the entitlement gate those two screens cannot be built.
//
// Nothing here is user-specific: seven static rows plus a count derived from
// published reads. The rest of /journey is that person's own stage and seed and
// stays gated.

import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { listStages } from "../services/journey/stages.service";

export const stagesRouter: Router = Router();

/** GET /v1/journey/stages */
stagesRouter.get(
  "/stages",
  asyncHandler(async (_req, res) => {
    const stages = await listStages();
    sendData(res, stagesListResponseSchema, {
      stages: stages.map((stage) => ({
        slug: stage.slug,
        order: stage.order,
        from: stage.from,
        to: stage.to,
        description: stage.description,
        anchorPassages: stage.anchorPassages,
        openingQuestions: stage.openingQuestions,
        // Derived per request from published reads. Never a constant — see
        // services/journey/availability.service.ts.
        available: stage.available,
        readCount: stage.readCount,
        firstReadTitle: stage.firstReadTitle,
      })),
    });
  }),
);
