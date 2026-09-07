// The journal.
//
// SPLIT ACROSS THE ENTITLEMENT GATE, and the split is the point:
//
//   journalRouter        behind the wall, like the rest of the product
//   journalExportRouter  IN FRONT OF IT, auth only
//
// The deletion screen says "Your journal is deleted with your account. Export
// it first if you want to keep it." Someone reading that sentence is leaving,
// and someone leaving has very often already let the subscription lapse. An
// export behind the paywall would make that sentence a lie for exactly the
// person it is written for.
//
// Nothing in this file reaches Abigail, and nothing else in the codebase
// imports the journal service. See src/tests/journal-isolation.test.ts.

import {
  createJournalEntryRequestSchema,
  deleteJournalEntryResponseSchema,
  journalEntryResponseSchema,
  journalExportResponseSchema,
  journalListQuerySchema,
  journalListResponseSchema,
  updateJournalEntryRequestSchema,
} from "@discern/shared";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { validateBody, validateQuery } from "../middleware/validate.middleware";
import {
  createEntry,
  deleteEntry,
  exportJournal,
  listEntries,
  updateEntry,
} from "../services/journal/journal.service";

export const journalRouter = Router();

/**
 * Both axes: by time (no filter) and by what you were carrying (`carryingId`).
 */
journalRouter.get(
  "/",
  requireAuth,
  loadUser,
  validateQuery(journalListQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as {
      carryingId?: string;
      limit: number;
      before?: string;
    };
    sendData(
      res,
      journalListResponseSchema,
      await listEntries(req.currentUser!._id, query),
    );
  }),
);

/**
 * 200 on a repeat, not 201 and not a conflict.
 *
 * The offline buffer resends the same `clientId` until it gets an answer, so
 * the second call is a retry rather than a new entry — and a retry that returns
 * an error would make the buffer either drop the entry or write it twice.
 */
journalRouter.post(
  "/",
  requireAuth,
  loadUser,
  validateBody(createJournalEntryRequestSchema),
  asyncHandler(async (req, res) => {
    const { entry, created } = await createEntry(req.currentUser!._id, req.body);
    sendData(res, journalEntryResponseSchema, { entry }, created ? 201 : 200);
  }),
);

journalRouter.patch(
  "/:id",
  requireAuth,
  loadUser,
  validateBody(updateJournalEntryRequestSchema),
  asyncHandler(async (req, res) => {
    sendData(res, journalEntryResponseSchema, {
      entry: await updateEntry(
        req.currentUser!._id,
        String(req.params.id),
        req.body.body,
      ),
    });
  }),
);

journalRouter.delete(
  "/:id",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await deleteEntry(req.currentUser!._id, id);
    sendData(res, deleteJournalEntryResponseSchema, { id, deleted: true });
  }),
);

/**
 * MOUNTED OUTSIDE THE ENTITLEMENT GATE. See the header, and app.ts.
 *
 * Its own router rather than a carve-out inside `journalRouter`, because a
 * carve-out is a thing someone deletes while tidying and a separate mount is a
 * thing someone has to move on purpose.
 */
export const journalExportRouter = Router();

journalExportRouter.get(
  "/export",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    sendData(
      res,
      journalExportResponseSchema,
      await exportJournal(req.currentUser!._id),
    );
  }),
);
