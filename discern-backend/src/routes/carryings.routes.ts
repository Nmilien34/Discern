import {
  createCarryingRequestSchema,
  updateCarryingRequestSchema,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";
import {
  addCarrying,
  listCarryings,
  updateCarrying,
} from "../services/journey/carryings.service";

export const carryingsRouter: Router = Router();

// GATED at the router mount in app.ts. No free tier, no carve-outs.

carryingsRouter.get(
  "/",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(res, await listCarryings(req.currentUser!._id));
  }),
);

/** Returns 409 at the cap, with the numbers, so the app can offer a release. */
carryingsRouter.post(
  "/",
  requireAuth,
  loadUser,
  validateBody(createCarryingRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      kind: "passage" | "hymn";
      reference: string;
      source: "abigail" | "self";
      why?: string;
    };

    sendData(
      res,
      await addCarrying(req.currentUser!._id, {
        kind: body.kind,
        reference: body.reference,
        source: body.source,
        ...(body.why ? { why: body.why } : {}),
      }),
      201,
    );
  }),
);

/** Notes, dwell time, release. Dwell also records a revisit. */
carryingsRouter.patch(
  "/:id",
  requireAuth,
  loadUser,
  validateBody(updateCarryingRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      note?: string;
      dwellSeconds?: number;
      release?: boolean;
    };

    sendData(
      res,
      await updateCarrying(req.currentUser!._id, String(req.params.id), body),
    );
  }),
);
