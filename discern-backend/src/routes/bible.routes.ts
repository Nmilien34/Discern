import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { validateQuery } from "../middleware/validate.middleware";
import {
  getAuthorBySlug,
  getChapter,
  getPassageByReference,
  listAuthors,
} from "../services/corpus/bible.service";

export const bibleRouter: Router = Router();

/**
 * Optional translation selector on every read route.
 *
 * Coerced and validated here so an unknown abbreviation is a 400 naming what is
 * available, rather than a silent fallback to the default — quietly serving WEB
 * to someone who asked for KJV is the kind of wrong nobody notices.
 */
const translationQuerySchema = z
  .object({ translation: z.string().min(1).max(16).optional() })
  .passthrough();

bibleRouter.get(
  "/authors",
  asyncHandler(async (_req, res) => {
    sendData(res, { authors: await listAuthors() });
  }),
);

bibleRouter.get(
  "/authors/:slug",
  asyncHandler(async (req, res) => {
    sendData(res, await getAuthorBySlug(String(req.params.slug ?? "")));
  }),
);

bibleRouter.get(
  "/books/:slug/:chapter",
  validateQuery(translationQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as { translation?: string };

    // Number() rather than parseInt: "3abc" should be rejected, not silently
    // read as 3. getChapter rejects a non-integer with a ValidationError.
    const chapter = Number(req.params.chapter);

    sendData(
      res,
      await getChapter(String(req.params.slug ?? ""), chapter, query.translation),
    );
  }),
);

/**
 * The reference is a single path segment and arrives percent-encoded:
 *
 *   /v1/bible/passages/Ephesians%202:8-10
 *   /v1/bible/passages/Eph%202:8-10
 *   /v1/bible/passages/John%203:16
 *   /v1/bible/passages/Matthew%209:35-10:4
 *
 * parseReference decodes it and throws a ValidationError on anything it cannot
 * read, so garbage returns 400 rather than 500.
 */
bibleRouter.get(
  "/passages/:reference",
  validateQuery(translationQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as { translation?: string };

    sendData(
      res,
      await getPassageByReference(
        String(req.params.reference ?? ""),
        query.translation,
      ),
    );
  }),
);
