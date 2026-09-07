// The journal.
//
// IT MOVED FROM THE PHONE TO THE SERVER ON 2026-09-06, reversing a decision
// that had been load-bearing since round two. What that buys: backup, so a
// dropped phone does not cost someone three years of writing; the same journal
// on a second device; the released-carrying surface from round 13 working from
// history rather than from whatever this phone happens to hold; and account
// deletion that actually deletes the journal, which resolves the contradiction
// that was sitting between the deletion code and the deletion copy.
//
// WHAT IT COSTS is the sentence "On this phone only. Nothing is sent anywhere."
// That line was the reason someone would write the thing they would not say out
// loud, and it is now false. It is gone from the tab header, the empty state,
// the settings row and the deletion screen, and it has NOT been softened into
// something that implies more privacy than exists.
//
// THE PROMISE THAT SURVIVES, AND GETS STRONGER RATHER THAN WEAKER:
//
//   The journal never reaches Abigail. Not summarised, not retrieved, not
//   referenced, not used as context, not embedded.
//
// While it was local, physics enforced that. It is now a collection in the same
// database the retrieval pipeline reads, so it is enforced instead by
// `src/tests/journal-isolation.test.ts`, a `no-restricted-imports` rule over
// the prompt, retrieval and cultivation directories, and a models barrel that
// registers the journal without re-exporting it — so reaching for it from those
// directories does not compile.
//
// NO EMBEDDING FIELD APPEARS IN THIS FILE OR IN THE MODEL, and there is a test
// asserting that. An embedded journal is one `$vectorSearch` from being
// retrievable, and that is the whole failure this design has to prevent.

import { z } from "zod";

import { JOURNAL_ORIGINS } from "../constants";

/**
 * One entry.
 *
 * `carryingId` is the round-13 attachment: an entry belongs to whatever was
 * being carried when it was written. That is what makes the by-carrying axis
 * and the released-carrying surface possible, and no competitor can copy it
 * because none of them have carryings.
 *
 * `passageReference` is DENORMALISED on purpose. The chip has to keep reading
 * "Matthew 5:23-24" after the carrying is released, and a released carrying is
 * routine — the active cap is three, so adding a fourth forces one down.
 */
export const journalEntrySchema = z
  .object({
    id: z.string(),
    body: z.string(),
    /** Null when nothing was being carried. Most first entries are null. */
    carryingId: z.string().nullable(),
    passageReference: z.string().nullable(),
    origin: z.enum(JOURNAL_ORIGINS),
    /**
     * THE CLIENT'S CLOCK, not the server's.
     *
     * Local storage stays as the write buffer so an entry survives being
     * offline, and an entry written on a plane and synced two days later
     * belongs to the night it was written. `createdAt` records when the server
     * first saw it, and the two are allowed to differ by a lot.
     */
    writtenAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type JournalEntry = z.infer<typeof journalEntrySchema>;

/**
 * POST /v1/journal
 *
 * `clientId` is what makes the offline buffer safe. The client mints it once
 * when the entry is written and resends the same one on every retry, so a
 * flaky sync produces one entry rather than four. Re-posting a clientId that
 * already exists returns the existing entry unchanged — it is not an error and
 * it is not an update, because a retry is not an edit.
 */
export const createJournalEntryRequestSchema = z
  .object({
    clientId: z.string().min(8).max(200),
    body: z.string().min(1).max(20_000),
    carryingId: z.string().nullable().optional(),
    origin: z.enum(JOURNAL_ORIGINS).optional(),
    /**
     * The client's clock, CLAMPED SERVER-SIDE rather than trusted or rejected.
     *
     * Time is the journal's primary axis, and this accepted any datetime at
     * all: an entry dated 2050 sorts above everything the person ever writes,
     * forever. But REFUSING a bad value is the wrong answer here — a rejected
     * PATCH loses somebody's writing, and a misdated entry is recoverable where
     * a lost one is not. So the server clamps and logs. See
     * services/journal/journal.service.ts for the window and why it is what it is.
     */
    /**
     * The client's clock, CLAMPED SERVER-SIDE rather than trusted or rejected.
     *
     * Time is the journal's primary axis, and this accepted any datetime at
     * all: an entry dated 2050 sorts above everything the person ever writes,
     * forever. But REFUSING a bad value is the wrong answer here — a rejected
     * write loses somebody's writing, and a misdated entry is recoverable where
     * a lost one is not. So the server clamps and logs. See
     * services/journal/journal.service.ts for the window and why it is what it is.
     */
    writtenAt: z.string().datetime().optional(),
  })
  .strict();

export type CreateJournalEntryRequest = z.infer<typeof createJournalEntryRequestSchema>;

export const updateJournalEntryRequestSchema = z
  .object({ body: z.string().min(1).max(20_000) })
  .strict();

export type UpdateJournalEntryRequest = z.infer<typeof updateJournalEntryRequestSchema>;

export const journalEntryResponseSchema = z
  .object({ entry: journalEntrySchema })
  .strict();

export type JournalEntryResponse = z.infer<typeof journalEntryResponseSchema>;

/**
 * GET /v1/journal
 *
 * Two axes, per round 13: by time, and by what you were carrying. The second is
 * this same endpoint with `carryingId` set, rather than a second endpoint, so
 * the released-carrying surface is one filtered read.
 */
export const journalListQuerySchema = z
  .object({
    carryingId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** `writtenAt` of the last entry on the previous page, exclusive. */
    before: z.string().datetime().optional(),
  })
  .strict();

export type JournalListQuery = z.infer<typeof journalListQuerySchema>;

export const journalListResponseSchema = z
  .object({
    entries: z.array(journalEntrySchema),
    /** Everything the user has ever written, ignoring the filter and the page. */
    total: z.number().int().nonnegative(),
    /** Pass as `before` to get the next page. Null at the end. */
    nextBefore: z.string().nullable(),
  })
  .strict();

export type JournalListResponse = z.infer<typeof journalListResponseSchema>;

export const deleteJournalEntryResponseSchema = z
  .object({ id: z.string(), deleted: z.literal(true) })
  .strict();

export type DeleteJournalEntryResponse = z.infer<typeof deleteJournalEntryResponseSchema>;

/**
 * GET /v1/journal/export
 *
 * OFFERED BEFORE THE DESTRUCTIVE TAP, not after. The deletion screen now says
 * "Your journal is deleted with your account. Export it first if you want to
 * keep it," and that sentence is only honest if the export is reachable at the
 * moment someone is leaving — which is also the moment their subscription may
 * already have lapsed. So this endpoint sits OUTSIDE the entitlement gate while
 * the rest of /v1/journal sits behind it. See app.ts.
 *
 * The whole journal in one response, unpaged. The client turns it into a file;
 * the server does not format documents.
 */
export const journalExportResponseSchema = z
  .object({
    generatedAt: z.string(),
    count: z.number().int().nonnegative(),
    entries: z.array(journalEntrySchema),
  })
  .strict();

export type JournalExportResponse = z.infer<typeof journalExportResponseSchema>;
