import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler";
import { sendData } from "../lib/responses";
import { AuthorModel, BookModel } from "../models";
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

/**
 * GET /v1/bible/books
 *
 * The table of contents. One call serves BOTH navigations the app offers:
 * book-first, in canonical order, and author-first, because each row carries
 * its author link.
 *
 * Sourced from the seeded books collection rather than the shared BOOKS
 * constant, because only the database knows which books have an author
 * document — several have none, and that is a fact about the text rather than
 * missing data.
 */
bibleRouter.get(
  "/books",
  asyncHandler(async (_req, res) => {
    const books = await BookModel.find({})
      .sort({ canonicalOrder: 1 })
      .select("slug name testament canonicalOrder chapterCount authorId")
      .lean();

    const authors = await AuthorModel.find({
      _id: { $in: books.map((b) => b.authorId).filter(Boolean) },
    })
      .select("slug name era")
      .lean();

    const authorById = new Map(authors.map((a) => [String(a._id), a]));

    sendData(res, {
      books: books.map((book) => {
        const author = book.authorId
          ? authorById.get(String(book.authorId))
          : undefined;

        return {
          slug: book.slug,
          name: book.name,
          testament: book.testament,
          canonicalOrder: book.canonicalOrder,
          chapterCount: book.chapterCount,
          // Null where nobody knows who wrote it. The app should render that
          // as unknown rather than hiding the book.
          author: author
            ? { slug: author.slug, name: author.name, era: author.era }
            : null,
        };
      }),
    });
  }),
);

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
