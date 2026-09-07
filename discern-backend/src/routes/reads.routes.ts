// Cultivation reads, and the two things a person can do with one.
//
// GATED. Reads are the paid half of the product; `/v1/journey/stages` stays
// ungated because onboarding needs the seven names before the paywall, but the
// reads themselves are what somebody is paying for.
//
// THE TWO WRITES ARE DIFFERENT SIZES ON PURPOSE — 2 points for finishing a
// read, 25 for going and doing the thing it asked. See seed-growth.ts.

import {
  readDetailResponseSchema,
  readProgressResponseSchema,
  readsListQuerySchema,
  readsListResponseSchema,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { validateQuery } from "../middleware/validate.middleware";
import {
  completeRead,
  getRead,
  listReads,
  markActionTaken,
} from "../services/journey/reads.service";
import type { StageSlug } from "@discern/shared";

export const readsRouter = Router();

/** The path for one virtue, in order, with this person's progress on it. */
readsRouter.get(
  "/reads",
  validateQuery(readsListQuerySchema),
  asyncHandler(async (req, res) => {
    const { stageSlug } = req.query as unknown as { stageSlug: StageSlug };
    sendData(
      res,
      readsListResponseSchema,
      await listReads(req.currentUser!._id, stageSlug),
    );
  }),
);

readsRouter.get(
  "/reads/:id",
  asyncHandler(async (req, res) => {
    sendData(res, readDetailResponseSchema, {
      read: await getRead(req.currentUser!._id, String(req.params.id)),
    });
  }),
);

/**
 * Finished it. Once ever, and a repeat is 200 with `awarded: false` rather than
 * an error — the client must be able to retry a lost response without either
 * dropping the completion or paying for it twice.
 */
readsRouter.post(
  "/reads/:id/complete",
  asyncHandler(async (req, res) => {
    sendData(
      res,
      readProgressResponseSchema,
      await completeRead(req.currentUser!._id, String(req.params.id)),
    );
  }),
);

/**
 * "This happened" — the control the design puts under a read's ask.
 *
 * The heaviest event in the ledger, and the only one earned outside the app.
 * REFUSED on a read with no action: 400, not a silent award.
 */
readsRouter.post(
  "/reads/:id/action",
  asyncHandler(async (req, res) => {
    sendData(
      res,
      readProgressResponseSchema,
      await markActionTaken(req.currentUser!._id, String(req.params.id)),
    );
  }),
);
