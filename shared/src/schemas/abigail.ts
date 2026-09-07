// Conversation contracts — including the STREAM, which is a contract like any
// other even though it does not arrive as one JSON body.
//
// A turn is 35-75 seconds and rounds 1-3 produce no visible text at all, so the
// non-streaming endpoint shows a person a blank screen for most of a minute.
// The stream is how the app shows the one thing that makes Abigail different
// from every other companion app: she is genuinely reading scripture before she
// answers. That makes the EVENT shapes as load-bearing as any response body,
// and they belong here rather than being re-typed by hand in the app.

import { z } from "zod";

export const conversationModeSchema = z.enum(["text", "voice"]);

export type ConversationMode = z.infer<typeof conversationModeSchema>;

/** POST /v1/abigail/conversations */
export const startConversationRequestSchema = z
  .object({ mode: conversationModeSchema.default("text") })
  .strict();

export type StartConversationRequest = z.infer<
  typeof startConversationRequestSchema
>;

export const startConversationResponseSchema = z
  .object({
    id: z.string(),
    mode: conversationModeSchema,
    startedAt: z.string(),
  })
  .strict();

export type StartConversationResponse = z.infer<
  typeof startConversationResponseSchema
>;

/**
 * POST /v1/abigail/conversations/:id/messages (and .../stream)
 *
 * `speakReply` is a REQUEST, not a switch. Three gates resolve it server-side
 * and every one of them can only say no, so asking cannot turn voice on where
 * the deployment says off.
 */
export const sendMessageRequestSchema = z
  .object({
    content: z.string().min(1).max(8000),
    speakReply: z.boolean().optional(),
  })
  .strict();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

/**
 * What speaking her PROSE cost this turn. Never merged with scripture audio:
 * scripture is a one-time permanent asset and this is recurring, because no two
 * replies are alike.
 */
export const spokenReplySchema = z
  .object({
    /** Whether speech was asked for AND allowed. False means text-only. */
    requested: z.boolean(),
    sentences: z.number().int().nonnegative(),
    charactersSynthesized: z.number().int().nonnegative(),
    /** Set when a ceiling refused. Show it; do not swallow it as an error. */
    refusedReason: z.string().nullable(),
  })
  .strict();

export type SpokenReply = z.infer<typeof spokenReplySchema>;

/**
 * POST .../messages — the whole turn as one body, after the wait.
 *
 * NO `spokenReply` here, deliberately: this route never speaks. Audio arrives
 * sentence by sentence as it is synthesized, which only the stream can express,
 * so a client that wants voice has to take the stream.
 */
export const turnResponseSchema = z
  .object({
    reply: z.string(),
    safetyIntercepted: z.boolean(),
    /** References she actually cited, as strings. */
    citations: z.array(z.string()),
    modelUsed: z.string(),
    latencyMs: z.number().nonnegative(),
  })
  .strict();

export type TurnResponse = z.infer<typeof turnResponseSchema>;

/** `event: done` — the same turn, plus what speaking it cost. */
export const turnDoneEventSchema = turnResponseSchema
  .extend({ spokenReply: spokenReplySchema })
  .strict();

export type TurnDoneEvent = z.infer<typeof turnDoneEventSchema>;

/**
 * THE PROGRESS EVENTS. `event: progress` on the SSE stream.
 *
 * REAL EVENTS ONLY — nothing here is emitted speculatively or on a timer, so a
 * client can render them as literal truth about what she is doing. Mirrors
 * `TurnProgress` in services/abigail/pipeline.ts.
 *
 * `restart` is the one a client must not swallow: the reply written so far has
 * been THROWN AWAY because grounding or the two-passage cap fired, and whatever
 * tokens were already rendered are no longer what she said. An app that appends
 * the next stream to the old one shows a person a reply that was never written.
 */
export const turnProgressSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("premise") }).strict(),
  z.object({ type: z.literal("searching"), query: z.string() }).strict(),
  z.object({ type: z.literal("found"), references: z.array(z.string()) }).strict(),
  z.object({ type: z.literal("reading"), reference: z.string() }).strict(),
  z.object({ type: z.literal("author"), name: z.string() }).strict(),
  z.object({ type: z.literal("choosing"), reference: z.string() }).strict(),
  z.object({ type: z.literal("writing") }).strict(),
  z.object({ type: z.literal("restart"), reason: z.string() }).strict(),
  z
    .object({
      type: z.literal("audio"),
      url: z.string(),
      text: z.string(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ type: z.literal("audio-unavailable"), reason: z.string() })
    .strict(),
]);

export type TurnProgress = z.infer<typeof turnProgressSchema>;

/** `event: token` — one delta of her reply. */
export const turnTokenSchema = z.object({ text: z.string() }).strict();

/**
 * `event: error`.
 *
 * The stream is already committed with a 200 by the time anything can go wrong,
 * so a failure cannot become a status code — it has to arrive as an event. A
 * client that only handles HTTP errors will sit on a dead stream forever.
 */
export const turnStreamErrorSchema = z.object({ message: z.string() }).strict();

/** GET /v1/abigail/conversations */
export const conversationSummarySchema = z
  .object({
    id: z.string(),
    mode: conversationModeSchema,
    startedAt: z.string(),
    lastMessageAt: z.string(),
    messageCount: z.number().int().nonnegative(),
    /**
     * The opening of what THEY said, never of what she replied. A person
     * scanning their own history is looking for the evening they brought
     * something, and her answer is not what they remember it by.
     */
    summary: z.string().nullable(),
    /** What she gave them in this conversation, deduplicated. */
    passages: z.array(z.string()),
  })
  .strict();

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationsListResponseSchema = z
  .object({
    conversations: z.array(conversationSummarySchema),
    /** A CURSOR, not a page number: pages stay stable as new rows arrive. */
    nextBefore: z.string().nullable(),
  })
  .strict();

export type ConversationsListResponse = z.infer<
  typeof conversationsListResponseSchema
>;

/** GET /v1/abigail/conversations/:id */
export const conversationMessageSchema = z
  .object({
    role: z.string(),
    content: z.string(),
    citations: z.array(z.string()),
    modelUsed: z.string().nullable(),
    safetyIntercepted: z.boolean(),
    at: z.string(),
  })
  .strict();

export const conversationDetailResponseSchema = z
  .object({
    id: z.string(),
    mode: conversationModeSchema,
    startedAt: z.string(),
    messages: z.array(conversationMessageSchema),
  })
  .strict();

export type ConversationDetailResponse = z.infer<
  typeof conversationDetailResponseSchema
>;

/**
 * POST /v1/abigail/transcribe — voice INPUT.
 *
 * Returns text only. What the person does with the transcript is theirs;
 * transcribing straight into a turn would mean a misheard sentence becomes
 * something they never said.
 */
export const transcribeResponseSchema = z
  .object({
    text: z.string(),
    seconds: z.number().nonnegative(),
    refusedReason: z.string().optional(),
  })
  .strict();

export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;
