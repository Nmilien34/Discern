// Response contracts for the Bible read routes (ARCHITECTURE.md §9).
//
// These exist from the first phase that returns a passage rather than being
// retrofitted, because the app and the API have to agree on these shapes before
// either is written. They are also the guard rail behind CONVENTIONS.md §6's
// `omit` rule: these schemas are STRICT, so a storage-only field that leaks into
// a response — `embedding`, a multi-hundred-float array — fails here loudly
// instead of quietly shipping megabytes to a phone.

import { z } from "zod";

import { ATTRIBUTIONS, LICENSE_TYPES, TESTAMENTS } from "../constants";

/**
 * Provenance of the ingested text.
 *
 * Public domain is a claim about a specific EDITION, not about a title, so the
 * URL, archive filename, checksum and date travel with the translation rather
 * than living in someone's memory.
 */
export const translationSourceSchema = z
  .object({
    url: z.string(),
    archive: z.string(),
    sha256: z.string(),
    downloadedAt: z.string(),
    licenceFile: z.string(),
  })
  .strict();

export const translationSchema = z
  .object({
    id: z.string(),
    abbreviation: z.string(),
    name: z.string(),
    licenseType: z.enum(LICENSE_TYPES),
    copyrightNotice: z.string(),
    isDefault: z.boolean(),
    /** Absent until the translation has been ingested from somewhere. */
    source: translationSourceSchema.optional(),
  })
  .strict();

export type Translation = z.infer<typeof translationSchema>;

/**
 * The author as a PERSON, not as a filter.
 *
 * ARCHITECTURE.md §6 and the Phase 2 brief are explicit that author-first
 * navigation is a core feature: this shape carries `circumstances` — what was
 * happening to them when they wrote — because that is the thing that makes
 * reading Philippians differently once you know it came from a prison. It also
 * feeds Abigail's get_author_context tool in Phase 6.
 */
export const authorSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    era: z.string(),
    attribution: z.enum(ATTRIBUTIONS),
    /** Present whenever attribution is not "traditional". */
    attributionNote: z.string().optional(),
    bookSlugs: z.array(z.string()),
  })
  .strict();

export type AuthorSummary = z.infer<typeof authorSummarySchema>;

export const authorDetailSchema = authorSummarySchema
  .extend({
    bio: z.string(),
    circumstances: z.string(),
    books: z.array(
      z
        .object({
          slug: z.string(),
          name: z.string(),
          testament: z.enum(TESTAMENTS),
          canonicalOrder: z.number().int(),
          chapterCount: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

export type AuthorDetail = z.infer<typeof authorDetailSchema>;

export const verseSchema = z
  .object({
    chapter: z.number().int().positive(),
    verse: z.number().int().positive(),
    text: z.string(),
  })
  .strict();

export type Verse = z.infer<typeof verseSchema>;

export const chapterResponseSchema = z
  .object({
    book: z
      .object({
        slug: z.string(),
        name: z.string(),
        testament: z.enum(TESTAMENTS),
        chapterCount: z.number().int(),
      })
      .strict(),
    author: authorSummarySchema.nullable(),
    translation: translationSchema,
    chapter: z.number().int().positive(),
    verses: z.array(verseSchema),
  })
  .strict();

export type ChapterResponse = z.infer<typeof chapterResponseSchema>;

/**
 * A passage — the retrievable unit, never a bare verse.
 *
 * NOTE what is absent: `embedding` and `embeddingModel`. They are storage, not
 * contract. The model declares the omission (CONVENTIONS.md §6) and this strict
 * schema is what turns a regression into a test failure.
 */
export const passageResponseSchema = z
  .object({
    /**
     * Null when the requested reference is an ad-hoc range rather than a stored
     * pericope.
     *
     * Both are legitimate. "Ephesians 2:8-10" is a segmented passage and has an
     * id; "Ephesians 2:9" is a valid thing to ask for and is assembled from
     * verses on the way out. Only a stored passage can be embedded, carried, or
     * returned by retrieval, so the null is the signal for which kind this is.
     */
    id: z.string().nullable(),
    reference: z.string(),
    bookSlug: z.string(),
    bookName: z.string(),
    chapter: z.number().int().positive(),
    startVerse: z.number().int().positive(),
    endVerse: z.number().int().positive(),
    /** Chapter of the last verse, when a passage crosses a chapter boundary. */
    endChapter: z.number().int().positive(),
    translation: translationSchema,
    text: z.string(),
    verses: z.array(verseSchema),
    author: authorSummarySchema.nullable(),
    themes: z.array(z.string()),
    stageSlugs: z.array(z.string()),
    situations: z.array(z.string()),
    /** Present when the passage's TEXT is disputed, e.g. John 7:53-8:11. */
    textualNote: z.string().optional(),
    /** One plain sentence describing the passage. Generated during enrichment. */
    summary: z.string().optional(),
  })
  .strict();

export type PassageResponse = z.infer<typeof passageResponseSchema>;

export const authorsListResponseSchema = z
  .object({ authors: z.array(authorSummarySchema) })
  .strict();

export type AuthorsListResponse = z.infer<typeof authorsListResponseSchema>;
