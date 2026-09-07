import {
  carryingSchema,
  carryingsListResponseSchema,
  createCarryingRequestSchema,
  passageAudioResponseSchema,
  updateCarryingRequestSchema,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { NotFoundError } from "../lib/errors";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { carryingUpdateLimiter } from "../middleware/rate-limit.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { CarryingModel, PassageModel } from "../models";
import { passageAudio } from "../services/speech/passage-audio";
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
    // `releasedLimit=0` gives the active list alone, for a screen that only
    // needs the three. `releasedTotal` always reports the true count.
    const limit = Number((req.query as { releasedLimit?: string }).releasedLimit);

    sendData(
      res,
      carryingsListResponseSchema,
      await listCarryings(req.currentUser!._id, {
        ...(Number.isInteger(limit) && limit >= 0
          ? { releasedLimit: Math.min(limit, 200) }
          : {}),
      }),
    );
  }),
);

/** Returns 409 at the cap, with the numbers, so the app can offer a release. */
carryingsRouter.post(
  "/",
  requireAuth,
  loadUser,
  validateBody(createCarryingRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { kind: "passage" | "hymn"; reference: string };

    sendData(
      res,
      carryingSchema,
      await addCarrying(req.currentUser!._id, {
        kind: body.kind,
        reference: body.reference,
        // HARDCODED, LIKE enterStage's "user" AT journey.routes.ts:53.
        //
        // This route is the client asking for something. The only way a
        // carrying can be Abigail's is the `offer_carrying` tool call in her
        // pipeline, which passes "abigail" and her own reason. A client that
        // could set this could claim she chose a passage for them and say why
        // she did — in an app whose whole premise is that she noticed something
        // they had not.
        source: "self",
        // AND NO `why`. It is not withheld, it does not exist: "why she gave
        // you this" is a sentence only she can write, and a self-added carrying
        // has nothing to put there.
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
  carryingUpdateLimiter,
  validateBody(updateCarryingRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      note?: string;
      dwellSeconds?: number;
      release?: boolean;
    };

    sendData(
      res,
      carryingSchema,
      await updateCarrying(req.currentUser!._id, String(req.params.id), body),
    );
  }),
);

/**
 * GET /v1/carryings/:id/audio
 *
 * The passage read aloud. VOICE ATTACHES TO A CARRYING, not to a turn — a
 * person opens what they are carrying and presses play, which is the moment an
 * ear is actually useful. Her prose is never synthesized.
 *
 * On demand and permanently cached: the first listener pays for the audio and
 * everyone after them does not.
 */
carryingsRouter.get(
  "/:id/audio",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const userId = req.currentUser!._id;

    const carrying = await CarryingModel.findOne({
      _id: String(req.params.id),
      userId,
    }).lean();

    if (!carrying) throw new NotFoundError("You are not carrying that.");

    const passage = await PassageModel.findById(carrying.refId)
      .select("reference")
      .lean();

    if (!passage) throw new NotFoundError("That passage is no longer available.");

    const query = req.query as { translation?: string };
    const audio = await passageAudio(
      passage.reference,
      String(userId),
      query.translation,
    );

    if (!audio) throw new NotFoundError("That passage cannot be read aloud.");

    sendData(res, passageAudioResponseSchema, audio);
  }),
);
