import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../lib/async-handler";
import { NotFoundError } from "../lib/errors";
import { sendData } from "../lib/responses";
import { loadUser, requireAuth } from "../middleware/auth.middleware";
import { abigailTurnLimiters } from "../middleware/rate-limit.middleware";
import { validateBody } from "../middleware/validate.middleware";
import { ConversationModel, MessageModel, UserModel } from "../models";
import { persistTurn, runTurn } from "../services/abigail/pipeline";

export const abigailRouter: Router = Router();

const startConversationSchema = z
  .object({ mode: z.enum(["text", "voice"]).default("text") })
  .strict();

const sendMessageSchema = z
  .object({ content: z.string().min(1).max(8000) })
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
