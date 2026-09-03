// THE ABIGAIL PIPELINE. ARCHITECTURE.md §7, in this exact order per turn.
//
//   1. SAFETY      hard gate. Fires -> the reasoning path NEVER runs.
//   2. CONTEXT     stage, carryings, memory, last N turns, passagesGiven
//   3. PREMISE     its own call, one question
//   4. REASONING   model with tools, sees the premise output
//   5. GROUNDING   enforced in code; regenerate once, then fall back
//   6. PERSIST     message, citations, seedEvents, memory
//
// The ordering is not stylistic. Safety before context means a person in crisis
// never has their disclosure fed through retrieval. Premise before reasoning
// means the hardest judgement is made where nothing else competes with it.

import OpenAI from "openai";
import type { Types } from "mongoose";

import { effort, models } from "../../config/models";
import { logger } from "../../lib/logger";
import {
  ConversationModel,
  MessageModel,
  SafetyEventModel,
  UserMemoryModel,
  UserStageModel,
} from "../../models";
import { UpstreamUnavailableError } from "../../lib/errors";
import { recordSeedEvent } from "../journey/seed.service";
import { classifyForSafety } from "../safety/classifier";
import { openaiFor } from "../../lib/openai-client";
import {
  checkGrounding,
  GROUNDING_FALLBACK,
  logGroundingFailure,
} from "./grounding";
import { runPremisePass } from "./premise";
import { ABIGAIL_SYSTEM_PROMPT, buildContextMessage } from "./prompt";
import {
  activeCarryingsFor,
  executeTool,
  searchScriptureTool,
  TOOL_DEFINITIONS,
} from "./tools";

// Raised from 5 after watching the eval: her working pattern is search, read
// several candidates, choose, then offer — which spends five rounds before she
// has written anything. At the old ceiling she reached the final round with
// tools disabled and hedged ("when you come back I can bring you a passage"),
// which is the one thing she must never do.
const MAX_TOOL_ROUNDS = 8;
const RECENT_TURNS = 8;

export interface TurnCost {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface TurnResult {
  reply: string;
  safetyIntercepted: boolean;
  safetyClassification: string;
  premiseVerdict: string;
  premise: string;
  citations: { ref: string; passageId: string | null }[];
  toolCalls: { name: string; arguments: string; resultSummary: string }[];
  modelUsed: string;
  costs: TurnCost[];
  latencyMs: number;
  grounded: boolean;
  regenerated: boolean;
  fellBack: boolean;
  /** Reasoning rounds actually spent. Each one is a model call. */
  reasoningRounds: number;
  /**
   * Per-round breakdown, so "the turn took 113 seconds" can be attributed.
   *
   * `modelMs` is wall-clock inside the OpenAI call. `toolMs` is retrieval —
   * which is itself mostly HyDE, another model call. `localMs` is everything
   * this process did on its own CPU: parsing tool results, assembling context,
   * fusion. That last one is the number that decides whether a bigger instance
   * would help, and it was not measured before 2026-09-02.
   */
  roundTimings: {
    round: number;
    modelMs: number;
    toolMs: number;
    localMs: number;
    tools: string[];
  }[];
}

let client: OpenAI | null = null;
const getClient = (): OpenAI =>
  (client ??= openaiFor("reasoning"));

/**
 * Which model answers this turn (ARCHITECTURE.md §7 model routing).
 *
 * The reasoning tier is reserved for turns that do real work. Everything else
 * gets the cheap tier, because running the expensive model on "thanks, that
 * helps" is the largest avoidable cost in the app.
 */
function chooseModel(premiseVerdict: string, _isFirstTurn: boolean): string {
  // MEASURED: the previous rule sent 18 of 18 non-blocked eval turns to the
  // reasoning tier, for two compounding reasons — the premise pass returned
  // "incomplete" on 83% of turns, and `isFirstTurn` routed the rest there
  // anyway. Since most conversations are one or two turns, "first turn" was
  // very nearly "every turn", and the tier meant nothing.
  //
  // Now: the expensive model is reserved for the turn that genuinely needs
  // judgement — telling someone the thing they believe is FALSE. Everything
  // else, including passages, stages and ordinary conversation, is the mid
  // tier. If quality drops on those turns this is the first thing to revert,
  // and a cheaper Abigail is not worth the saving.
  if (premiseVerdict === "wrong") return models.reasoning;
  return models.conversation;
}

export async function runTurn(
  userId: Types.ObjectId,
  conversationId: Types.ObjectId,
  userMessage: string,
): Promise<TurnResult> {
  const startedAt = Date.now();
  const costs: TurnCost[] = [];

  try {
    return await runTurnInner(userId, conversationId, userMessage, startedAt, costs);
  } catch (error) {
    // NOTHING IS PERSISTED ON THIS PATH. persistTurn is called by the route
    // AFTER this returns, so a throw here means the turn did not happen at all
    // — no half-written conversation, no user message hanging with no reply.
    //
    // Rethrown as 503 rather than escaping as a 500: an OpenAI timeout or
    // outage is "try again", and the app should offer to resend rather than
    // showing a failure. What the person typed is still in their compose box.
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        userId: String(userId),
        conversationId: String(conversationId),
        elapsedMs: Date.now() - startedAt,
        costsSoFar: costs.length,
      },
      "abigail turn failed",
    );

    throw new UpstreamUnavailableError();
  }
}

async function runTurnInner(
  userId: Types.ObjectId,
  conversationId: Types.ObjectId,
  userMessage: string,
  startedAt: number,
  costs: TurnCost[],
): Promise<TurnResult> {
  // ---- 1. SAFETY GATE ------------------------------------------------------
  const safety = await classifyForSafety(userMessage);
  costs.push({
    model: safety.modelUsed,
    tokensIn: safety.tokensIn,
    tokensOut: safety.tokensOut,
  });

  if (safety.blocked) {
    // THE REASONING PATH NEVER RUNS. No retrieval, no premise pass, no model
    // reflecting on what was disclosed.
    await SafetyEventModel.create({
      userId,
      conversationId,
      classification: safety.classification,
      actionTaken: safety.failedClosed
        ? "blocked (classifier unavailable — failed closed)"
        : "blocked; crisis resources returned",
      messageExcerpt: userMessage.slice(0, 200),
      modelUsed: safety.modelUsed,
    });

    return {
      reply: safety.response ?? "",
      safetyIntercepted: true,
      roundTimings: [],
      safetyClassification: safety.classification,
      premiseVerdict: "not-run",
      premise: "",
      citations: [],
      toolCalls: [],
      modelUsed: safety.modelUsed,
      costs,
      latencyMs: Date.now() - startedAt,
      grounded: true,
      regenerated: false,
      fellBack: false,
      reasoningRounds: 0,
    };
  }

  // ---- 2. CONTEXT ASSEMBLY -------------------------------------------------
  const [memory, openStage, carryings, priorMessages] = await Promise.all([
    UserMemoryModel.findOne({ userId }),
    UserStageModel.findOne({ userId, closedAt: null }),
    activeCarryingsFor(userId),
    MessageModel.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(RECENT_TURNS * 2)
      .lean(),
  ]);

  const recentTurns = priorMessages.map(
    (m) => `${m.role === "user" ? "Them" : "You"}: ${m.content.slice(0, 400)}`,
  );

  // ---- 3. PREMISE PASS -----------------------------------------------------
  const premise = await runPremisePass(userMessage, { recentTurns });
  costs.push({
    model: premise.modelUsed,
    tokensIn: premise.tokensIn,
    tokensOut: premise.tokensOut,
  });

  const passagesGiven = (memory?.passagesGiven ?? []).map((p) => ({
    ref: p.ref,
    why: p.why,
  }));

  // ---- 4. REASONING TURN ---------------------------------------------------
  const chosenModel = chooseModel(premise.verdict, priorMessages.length === 0);

  const retrievedFromPreSearch: string[] = [];

  const toolContext = {
    userId,
    conversationId,
    passagesAlreadyGiven: passagesGiven.map((p) => p.ref),
    // Retrieval's own spend lands in the same array as everything else, so the
    // turn's cost is the turn's cost rather than the part that was easy to see.
    onUsage: (usage: { model: string; tokensIn: number; tokensOut: number }) => {
      costs.push(usage);
    },
  };

  // ---- 4a. PRE-SEARCH ------------------------------------------------------
  //
  // She used to spend a round deciding to search and another reading what came
  // back, before writing anything. The premise pass has ALREADY run by this
  // point and already names the subject — `realQuestion` is what they are
  // actually asking, which is exactly the thing worth searching for.
  //
  // So one search runs here, unprompted, and the results are in her opening
  // context. The tool stays available: this is a starting point, not a
  // constraint, and if the seeded passages are wrong she searches again.
  //
  // Seeded from realQuestion, falling back to the raw message when the premise
  // pass was unavailable — never from `correction`, which is what SHE would
  // say rather than what THEY are dealing with, and retrieves her own words.
  const preSearchQuery = premise.realQuestion?.trim() || userMessage;

  let preSearched: string | null = null;

  try {
    const seeded = await searchScriptureTool({ query: preSearchQuery }, toolContext);
    if (seeded.citations.length > 0) {
      preSearched = seeded.resultSummary;
      retrievedFromPreSearch.push(...seeded.citations.map((c) => c.ref));
    }
  } catch (error) {
    // A failed pre-search is a lost optimisation, not a lost turn. She still
    // has the tool.
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "pre-search failed; falling through to the tool loop",
    );
  }

  const contextMessage = buildContextMessage({
    premise,
    currentStage: openStage
      ? { slug: openStage.stageSlug, from: openStage.stageSlug, to: "" }
      : null,
    carryings,
    facts: (memory?.facts ?? []).map((f) => f.text),
    people: memory?.peopleMentioned ?? [],
    passagesGiven,
    openThreads: (memory?.openThreads ?? []).map((t) => t.text),
    preSearched,
  });

  const runReasoning = async (
    extraInstruction?: string,
  ): Promise<{
    reply: string;
    citations: { ref: string; passageId: string | null }[];
    toolCalls: { name: string; arguments: string; resultSummary: string }[];
    retrievedReferences: string[];
    rounds: number;
    timings: TurnResult["roundTimings"];
  }> => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: ABIGAIL_SYSTEM_PROMPT },
      { role: "system", content: contextMessage },
      ...priorMessages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    if (extraInstruction) {
      messages.push({ role: "system", content: extraInstruction });
    }

    const citations: { ref: string; passageId: string | null }[] = [];
    const toolCalls: { name: string; arguments: string; resultSummary: string }[] =
      [];
    const retrievedReferences: string[] = [];
    const roundTimings: TurnResult["roundTimings"] = [];
    let roundsUsed = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      // ON THE LAST ROUND, TAKE THE TOOLS AWAY.
      //
      // Without this the loop can exhaust while the model is still calling
      // get_passage — it returns no final text, `reply` is empty, and the
      // caller silently emits the grounding fallback while REPORTING
      // grounded=true. Four of twenty-one eval turns failed exactly this way,
      // and the flags said the pipeline was fine. Removing the tools forces an
      // answer from what has already been retrieved.
      const isFinalRound = round === MAX_TOOL_ROUNDS - 1;

      roundsUsed += 1;
      const roundStartedAt = Date.now();
      let modelMs = 0;
      let toolMs = 0;
      const toolNames: string[] = [];

      const modelStartedAt = Date.now();
      const response = await getClient().chat.completions.create({
        model: chosenModel,
        // Matched to the tier that was routed to, not to a constant: the cheap
        // tier answers most turns and does not need an extended chain, while a
        // `wrong` premise is the one case worth paying for.
        reasoning_effort:
          chosenModel === models.reasoning ? effort.reasoning : effort.conversation,
        messages,
        ...(isFinalRound
          ? { tools: TOOL_DEFINITIONS, tool_choice: "none" as const }
          : { tools: TOOL_DEFINITIONS }),
        max_completion_tokens: 16_000,
      });

      modelMs = Date.now() - modelStartedAt;

      costs.push({
        model: chosenModel,
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
      });

      const choice = response.choices[0];
      const message = choice?.message;
      if (!message) break;

      messages.push(message as OpenAI.Chat.ChatCompletionMessageParam);

      const calls = message.tool_calls ?? [];

      if (calls.length === 0) {
        roundTimings.push({
          round: roundsUsed,
          modelMs,
          toolMs: 0,
          localMs: Math.max(0, Date.now() - roundStartedAt - modelMs),
          tools: [],
        });

        return {
          reply: message.content ?? "",
          citations,
          toolCalls,
          retrievedReferences,
          rounds: roundsUsed,
          timings: roundTimings,
        };
      }

      // SEQUENTIAL, DELIBERATELY LEFT SO FOR NOW.
      //
      // When the model emits two or three tool calls in one round they run one
      // after another, and each search is ~12.5s of which ~10.9s is the HyDE
      // rewrite. Running them concurrently is the obvious win; it is not taken
      // here because the measurement it would invalidate has not been reported
      // yet. See docs/STATUS.md.
      const toolsStartedAt = Date.now();

      for (const call of calls) {
        if (call.type !== "function") continue;

        toolNames.push(call.function.name);

        const invocation = await executeTool(
          call.function.name,
          call.function.arguments,
          toolContext,
        );

        toolCalls.push({
          name: invocation.name,
          arguments: invocation.arguments,
          resultSummary: invocation.resultSummary.slice(0, 1000),
        });
        citations.push(...invocation.citations);
        retrievedReferences.push(...invocation.citations.map((c) => c.ref));

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: invocation.resultSummary,
        });
      }

      toolMs = Date.now() - toolsStartedAt;

      roundTimings.push({
        round: roundsUsed,
        modelMs,
        toolMs,
        // Whatever is left is this process's own CPU: JSON parsing, context
        // assembly, RRF fusion, hydration. On half a core this is the term the
        // hardware question turns on.
        localMs: Math.max(0, Date.now() - roundStartedAt - modelMs - toolMs),
        tools: toolNames,
      });
    }

    // Reached only if the final round still produced nothing at all.
    return {
      reply: "",
      citations,
      toolCalls,
      retrievedReferences,
      rounds: roundsUsed,
      timings: roundTimings,
    };
  };

  let attempt = await runReasoning();
  let regenerated = false;
  let fellBack = false;
  let emptyReply = false;

  // An empty reply is its own failure and must not be laundered into a
  // grounding verdict. checkGrounding treats "" as non-substantive and therefore
  // grounded, which is technically true and completely misleading.
  if (!attempt.reply.trim()) {
    emptyReply = true;
    logger.warn(
      { toolCalls: attempt.toolCalls.length },
      "reasoning produced no text after the tool loop",
    );
  }

  // ---- 5. GROUNDING CHECK --------------------------------------------------
  let verdict = checkGrounding({
    reply: attempt.reply,
    retrievedReferences: attempt.retrievedReferences,
    toolCallCount: attempt.toolCalls.length,
  });

  if (!verdict.grounded || emptyReply) {
    if (!verdict.grounded) logGroundingFailure(verdict, 1);
    regenerated = true;

    attempt = await runReasoning(
      emptyReply
        ? "You called tools but never wrote an answer. You have enough now. Write your reply to them, citing only references the tools returned."
        : `YOUR PREVIOUS ANSWER FAILED THE GROUNDING CHECK: ${verdict.reason} ` +
            "Call search_scripture or get_passage, and cite only references those tools returned. " +
            "Do not cite anything from memory.",
    );

    verdict = checkGrounding({
      reply: attempt.reply,
      // Pre-searched passages count on BOTH axes. She was handed them by a
      // real tool call, so citing one is grounded, and a turn that needed no
      // further search is the pre-search working rather than a reply with
      // nothing behind it.
      retrievedReferences: [
        ...attempt.retrievedReferences,
        ...retrievedFromPreSearch,
      ],
      toolCallCount: attempt.toolCalls.length + retrievedFromPreSearch.length,
    });

    if (!verdict.grounded || !attempt.reply.trim()) {
      logGroundingFailure(verdict, 2);
      fellBack = true;
      attempt.reply = GROUNDING_FALLBACK;
    }
  }

  return {
    reply: attempt.reply || GROUNDING_FALLBACK,
    safetyIntercepted: false,
    safetyClassification: "none",
    premiseVerdict: premise.verdict,
    premise: premise.premise,
    citations: attempt.citations,
    toolCalls: attempt.toolCalls,
    modelUsed: chosenModel,
    costs,
    latencyMs: Date.now() - startedAt,
    grounded: verdict.grounded && !fellBack,
    regenerated,
    fellBack,
    reasoningRounds: attempt.rounds,
    roundTimings: attempt.timings,
  };
}

/**
 * 6. PERSIST. Message, citations, memory, seed events.
 *
 * Runs after the reply is produced so a bookkeeping failure cannot cost someone
 * their answer.
 */
export async function persistTurn(
  userId: Types.ObjectId,
  conversationId: Types.ObjectId,
  userMessage: string,
  result: TurnResult,
): Promise<void> {
  // ONE WRITE, NOT TWO.
  //
  // These were two sequential creates. A failure between them left the user's
  // message in the conversation with no reply after it — the transcript would
  // show someone saying the hardest thing they had to say and Abigail saying
  // nothing back. insertMany sends them together, which closes that window
  // without pulling a transaction and a replica-set requirement into the path.
  await MessageModel.insertMany([
    {
      conversationId,
      userId,
      role: "user",
      content: userMessage,
    },
    {
    conversationId,
    userId,
    role: "assistant",
    content: result.reply,
    citations: result.citations.map((c) => ({
      ref: c.ref,
      passageId: c.passageId,
      translationId: null,
    })),
    toolCalls: result.toolCalls,
    modelUsed: result.modelUsed,
    tokensIn: result.costs.reduce((n, c) => n + c.tokensIn, 0),
    tokensOut: result.costs.reduce((n, c) => n + c.tokensOut, 0),
    // The breakdown, so spend can be priced per model instead of guessed.
    costs: result.costs.map((c) => ({
      model: c.model,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
    })),
    latencyMs: result.latencyMs,
    safetyIntercepted: result.safetyIntercepted,
    },
  ]);

  // A blocked turn is not practice and does not touch memory or the ledger.
  if (result.safetyIntercepted) return;

  const offered = result.toolCalls.filter((t) => t.name === "offer_carrying");

  await UserMemoryModel.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: { userId },
      ...(offered.length > 0
        ? {
            $push: {
              passagesGiven: {
                $each: offered.flatMap((t) => {
                  try {
                    const args = JSON.parse(t.arguments) as {
                      reference?: string;
                      why?: string;
                    };
                    return args.reference
                      ? [{ ref: args.reference, why: args.why ?? "", at: new Date() }]
                      : [];
                  } catch {
                    return [];
                  }
                }),
              },
            },
          }
        : {}),
    },
    { upsert: true },
  );

  if (result.premise) {
    await ConversationModel.updateOne(
      { _id: conversationId },
      { $addToSet: { premisesNoted: result.premise } },
    );
  }

  const turnCount = await MessageModel.countDocuments({
    conversationId,
    role: "user",
  });

  await recordSeedEvent({
    userId,
    type: "conversation_depth",
    weight: turnCount,
    sourceId: conversationId,
  });

  // premise_reframed fires only when she actually corrected something. It is the
  // moment the product is for, and awarding it for every turn would make it
  // meaningless.
  if (result.premiseVerdict === "wrong" || result.premiseVerdict === "incomplete") {
    await recordSeedEvent({
      userId,
      type: "premise_reframed",
      weight: 1,
      sourceId: conversationId,
    });
  }

  logger.info(
    {
      conversationId: String(conversationId),
      model: result.modelUsed,
      premiseVerdict: result.premiseVerdict,
      toolCalls: result.toolCalls.length,
      grounded: result.grounded,
      regenerated: result.regenerated,
      latencyMs: result.latencyMs,
    },
    "abigail turn complete",
  );
}
