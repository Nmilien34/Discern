import express, { Router } from "express";
import { z } from "zod";

import { env } from "../config/env";

import { asyncHandler } from "../lib/async-handler";
import { logger } from "../lib/logger";
import { NotFoundError, ValidationError } from "../lib/errors";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import {
  abigailTurnLimiters,
  transcribeLimiter,
} from "../middleware/rate-limit.middleware";
import { validateBody, validateQuery } from "../middleware/validate.middleware";
import { ConversationModel, MessageModel, UserModel } from "../models";
import { persistTurn, runTurn } from "../services/abigail/pipeline";
import { transcribe } from "../services/speech/stt";

export const abigailRouter: Router = Router();

const startConversationSchema = z
  .object({ mode: z.enum(["text", "voice"]).default("text") })
  .strict();

const listConversationsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** ISO timestamp from a previous page's `nextBefore`. */
    before: z.string().datetime().optional(),
  })
  .strict();

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(8000),
    /**
     * Ask for her reply to be spoken as well as written.
     *
     * A REQUEST, NOT A SWITCH. It is resolved against the deployment flag and
     * the user's own preference below; asking cannot turn voice on where the
     * deployment says no.
     */
    speakReply: z.boolean().optional(),
  })
  .strict();

/**
 * Should this person hear her prose on this turn?
 *
 * Three gates, and every one can only say no:
 *
 *   VOICE_ENABLED   nothing is spoken without it, prose or scripture
 *   the user        `speakReplies` on their preferences. null defers to the
 *                   deployment; true or false overrides it — which is what
 *                   lets a subset of testers hear her while everyone reads
 *   SPEAK_REPLIES   the deployment default, when the user has no preference
 *
 * The request flag is last and can only decline: a client that omits it gets
 * text, even where everything else is on. Speaking costs money per reply and
 * never caches, so the default at every layer is silence.
 */
function shouldSpeakReply(
  user: { preferences: { speakReplies: boolean | null } },
  requested: boolean | undefined,
): boolean {
  if (!env.VOICE_ENABLED) return false;
  if (requested !== true) return false;

  return user.preferences.speakReplies ?? env.SPEAK_REPLIES;
}

/**
 * POST /v1/abigail/conversations
 *
 * The allowance counter is incremented INSIDE creation, after the conversation
 * document exists — a Phase 4 fix. Previously the increment ran first, so a
 * failure afterwards burned one of three free conversations for something that
 * never existed.
 */
abigailRouter.post(
  "/conversations",
  requireAuth,
  loadUser,
  validateBody(startConversationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { mode: "text" | "voice" };
    const userId = req.currentUser!._id;

    const conversation = await ConversationModel.create({
      userId,
      mode: body.mode,
      startedAt: new Date(),
    });

    await UserModel.updateOne(
      { _id: userId },
      {
        $inc: { abigailConversationsStarted: 1 },
        $set: { lastActiveAt: new Date() },
      },
    );

    sendData(
      res,
      {
        id: String(conversation._id),
        mode: conversation.mode,
        startedAt: conversation.startedAt.toISOString(),
      },
      201,
    );
  }),
);

/** POST /v1/abigail/conversations/:id/messages — one full pipeline turn. */
abigailRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  loadUser,
  // AFTER loadUser: the per-user limiters key on req.currentUser, and placed
  // any earlier they would fall back to the IP and bucket everyone together.
  ...abigailTurnLimiters,
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const userId = req.currentUser!._id;
    const conversation = await ConversationModel.findOne({
      _id: String(req.params.id),
      userId,
    });

    if (!conversation) throw new NotFoundError("No such conversation.");

    const body = req.body as { content: string; speakReply?: boolean };

    const result = await runTurn(userId, conversation._id, body.content, {
      speakReply: shouldSpeakReply(req.currentUser!, body.speakReply),
    });
    await persistTurn(userId, conversation._id, body.content, result);

    sendData(res, {
      reply: result.reply,
      safetyIntercepted: result.safetyIntercepted,
      citations: result.citations.map((c) => c.ref),
      modelUsed: result.modelUsed,
      latencyMs: result.latencyMs,
    });
  }),
);

/**
 * POST /v1/abigail/conversations/:id/messages/stream
 *
 * The same turn, as Server-Sent Events. FOR THE THROWAWAY TEST CLIENT — delete
 * it with the rest of that surface, or promote it deliberately.
 *
 * A turn is 35-75 seconds and rounds 1-3 produce no text at all, so the JSON
 * endpoint above shows a person a blank screen for most of a minute. This one
 * emits what she is actually doing — searching, what she found, what she is
 * reading, what she chose — and then streams the reply as she writes it.
 *
 * Events: `progress` (a TurnProgress), `token` ({text}), `done` (the result),
 * `error`. Persistence and every gate are identical; only the transport differs.
 */
abigailRouter.post(
  "/conversations/:id/messages/stream",
  requireAuth,
  loadUser,
  ...abigailTurnLimiters,
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const userId = req.currentUser!._id;
    const conversation = await ConversationModel.findOne({
      _id: String(req.params.id),
      userId,
    });

    if (!conversation) throw new NotFoundError("No such conversation.");

    const body = req.body as { content: string; speakReply?: boolean };
    const content = body.content;
    const speakReply = shouldSpeakReply(req.currentUser!, body.speakReply);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    // Render buffers proxied responses without this, which would defeat the
    // entire point by delivering every event at once at the end.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // A client that closes mid-turn must not keep the pipeline writing.
    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    try {
      const result = await runTurn(userId, conversation._id, content, {
        speakReply,
        onProgress: (event) => {
          if (!aborted) send("progress", event);
        },
        onToken: (text) => {
          if (!aborted) send("token", { text });
        },
      });

      await persistTurn(userId, conversation._id, content, result);

      send("done", {
        reply: result.reply,
        safetyIntercepted: result.safetyIntercepted,
        citations: result.citations.map((c) => c.ref),
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        // Kept apart from scripture audio, which is a one-time asset.
        spokenReply: result.spokenReply,
      });
    } catch (error) {
      // The stream has already been committed with a 200, so a failure cannot
      // become a status code — it has to arrive as an event.
      send("error", {
        message: "Abigail could not answer just now. Please send that again.",
      });
      logger.error(
        { err: error instanceof Error ? error.message : error },
        "streamed turn failed",
      );
    } finally {
      res.end();
    }
  }),
);

/**
 * POST /v1/abigail/transcribe
 *
 * Voice INPUT. Costed and reported separately from synthesis, because speaking
 * the problem out loud and hearing the answer read back are different products
 * with different economics and should be able to ship independently.
 *
 * Returns text only. What the person does with the transcript — send it, edit
 * it first — is theirs, and transcribing straight into a turn would mean a
 * misheard sentence becomes something they never said.
 */
abigailRouter.post(
  "/transcribe",
  requireAuth,
  loadUser,
  transcribeLimiter,
  // Audio, not JSON. 10 MB is several minutes of speech at the bitrates a
  // browser produces, and past that it is not somebody talking.
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "10mb" }),
  asyncHandler(async (req, res) => {
    const body = req.body as Buffer;

    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new ValidationError("Send the recording as an audio body.");
    }

    const result = await transcribe(
      new Uint8Array(body),
      String(req.currentUser!._id),
      "input.webm",
    );

    sendData(res, {
      text: result.text,
      seconds: result.seconds,
      ...(result.refusedReason ? { refusedReason: result.refusedReason } : {}),
    });
  }),
);

/**
 * GET /v1/abigail/conversations
 *
 * The history list. Paginated, most recent first, and carrying enough per row
 * to render the screen WITHOUT a second call per conversation — a list view
 * that needs one request per row is a list view that stalls on a slow phone.
 *
 * `summary` is the opening of what THEY said, not of what she replied. A person
 * scanning their own history is looking for the evening they brought something,
 * and her answer is not what they remember it by.
 */
abigailRouter.get(
  "/conversations",
  requireAuth,
  loadUser,
  validateQuery(listConversationsSchema),
  asyncHandler(async (req, res) => {
    const userId = req.currentUser!._id;
    const { limit, before } = req.query as unknown as {
      limit: number;
      before?: string;
    };

    // Cursor on startedAt rather than an offset: pages stay stable while new
    // conversations arrive at the top, which offsets do not.
    const conversations = await ConversationModel.find({
      userId,
      ...(before ? { startedAt: { $lt: new Date(before) } } : {}),
    })
      .sort({ startedAt: -1 })
      .limit(limit + 1)
      .lean();

    const page = conversations.slice(0, limit);
    const hasMore = conversations.length > limit;

    const messages = await MessageModel.find({
      conversationId: { $in: page.map((c) => c._id) },
    })
      .sort({ createdAt: 1 })
      .select("conversationId role content citations createdAt")
      .lean();

    const byConversation = new Map<string, typeof messages>();
    for (const m of messages) {
      const key = String(m.conversationId);
      byConversation.set(key, [...(byConversation.get(key) ?? []), m]);
    }

    sendData(res, {
      conversations: page.map((conversation) => {
        const rows = byConversation.get(String(conversation._id)) ?? [];
        const firstFromThem = rows.find((m) => m.role === "user");
        const last = rows[rows.length - 1];

        return {
          id: String(conversation._id),
          mode: conversation.mode,
          startedAt: conversation.startedAt.toISOString(),
          lastMessageAt: (last?.createdAt ?? conversation.startedAt).toISOString(),
          messageCount: rows.length,
          summary: firstFromThem
            ? firstFromThem.content.slice(0, 140)
            : null,
          // What she gave them in this conversation, deduplicated — the thing
          // most worth seeing in a list of past evenings.
          passages: [
            ...new Set(rows.flatMap((m) => m.citations.map((c) => c.ref))),
          ],
        };
      }),
      // Cursor, not a page number, for the same reason as above.
      nextBefore: hasMore ? page[page.length - 1]?.startedAt.toISOString() : null,
    });
  }),
);

/** GET /v1/abigail/conversations/:id */
abigailRouter.get(
  "/conversations/:id",
  requireAuth,
  loadUser,
  asyncHandler(async (req, res) => {
    const userId = req.currentUser!._id;
    const conversation = await ConversationModel.findOne({
      _id: String(req.params.id),
      userId,
    });

    if (!conversation) throw new NotFoundError("No such conversation.");

    const messages = await MessageModel.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .lean();

    sendData(res, {
      id: String(conversation._id),
      mode: conversation.mode,
      startedAt: conversation.startedAt.toISOString(),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations.map((c) => c.ref),
        // modelUsed is exposed so spend is inspectable per conversation.
        modelUsed: m.modelUsed,
        safetyIntercepted: m.safetyIntercepted,
        at: m.createdAt.toISOString(),
      })),
    });
  }),
);
