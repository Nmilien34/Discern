import express, { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler";
import { logger } from "../lib/logger";
import { NotFoundError, ValidationError } from "../lib/errors";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import {
  abigailTurnLimiters,
  transcribeLimiter,
} from "../middleware/rate-limit.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { ConversationModel, MessageModel, UserModel } from "../models";
import { persistTurn, runTurn } from "../services/abigail/pipeline";
import { transcribe } from "../services/speech/stt";

export const abigailRouter: Router = Router();

const startConversationSchema = z
  .object({ mode: z.enum(["text", "voice"]).default("text") })
  .strict();

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(8000),
  })
  .strict();

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

    const { content } = req.body as { content: string };

    const result = await runTurn(userId, conversation._id, content);
    await persistTurn(userId, conversation._id, content, result);

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

    const { content } = req.body as { content: string };

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
