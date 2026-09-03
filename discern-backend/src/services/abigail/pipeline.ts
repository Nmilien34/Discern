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
import { SentenceSplitter, speakable } from "../speech/sentences";
import { synthesize } from "../speech/tts";
import { classifyForSafety } from "../safety/classifier";
import { openaiFor } from "../../lib/openai-client";
import {
  checkGrounding,
  referencedPassages,
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

/**
 * Passages a single reply may reference.
 *
 * The product is one person sitting with ONE thing long enough for it to change
 * them. Two exists only for the case where a second passage does genuinely
 * different work; a reply carrying more is a search result in a pastor's voice.
 */
const MAX_PASSAGES_IN_REPLY = 2;
const RECENT_TURNS = 8;

/**
 * What she is doing right now, for a client that would otherwise show nothing.
 *
 * Rounds 1-3 produce no visible text — she is searching, reading and choosing —
 * and on a p90 turn that is a blank screen for the better part of a minute.
 * These events exist so a person can watch the one thing that makes her
 * different from every other companion app: she is genuinely reading scripture
 * before she answers.
 *
 * REAL EVENTS ONLY. Nothing here is emitted speculatively or on a timer; every
 * one corresponds to work that has actually happened.
 */
export type TurnProgress =
  | { type: "premise" }
  | { type: "searching"; query: string }
  | { type: "found"; references: string[] }
  | { type: "reading"; reference: string }
  | { type: "author"; name: string }
  | { type: "choosing"; reference: string }
  | { type: "writing" }
  /** The reply is being replaced — grounding or the passage cap fired. */
  | { type: "restart"; reason: string }
  /** A sentence has been synthesized and can play now. */
  | { type: "audio"; url: string; text: string; cached: boolean; index: number }
  /** Voice is off for this turn. She still answers, in text. */
  | { type: "audio-unavailable"; reason: string };

export interface TurnOptions {
  /** Called as work happens. Never on a timer. */
  onProgress?: (event: TurnProgress) => void;
  /** Called with each text delta of the reply as the model emits it. */
  onToken?: (text: string) => void;
  /**
   * Synthesize each sentence as she finishes it.
   *
   * VOICE IS THE UPGRADE, NEVER THE DEFAULT (ARCHITECTURE.md §10 decision 1),
   * so this is off unless a caller asks and the caller has checked entitlement.
   * Synthesis happens per sentence rather than per reply because waiting for
   * the whole reply would add a second wait on top of a forty-nine second one.
   */
  voice?: boolean;
}

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
  /** True when the reply had to be regenerated for referencing too many passages. */
  citationCapRegenerated: boolean;
  /** What voice cost on this turn. Zero on a text turn, and zero on cache hits. */
  speech: {
    requested: boolean;
    sentences: number;
    charactersSynthesized: number;
    charactersFromCache: number;
    /** null when voice was not requested or was never refused. */
    refusedReason: string | null;
    audioKeys: string[];
  };
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
  options: TurnOptions = {},
): Promise<TurnResult> {
  const startedAt = Date.now();
  const costs: TurnCost[] = [];

  try {
    return await runTurnInner(
      userId,
      conversationId,
      userMessage,
      startedAt,
      costs,
      options,
    );
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
  options: TurnOptions,
): Promise<TurnResult> {
  const progress = (event: TurnProgress): void => {
    try {
      options.onProgress?.(event);
    } catch {
      // A client that has hung up must not take the turn down with it.
    }
  };

  // ---- VOICE, SENTENCE BY SENTENCE -----------------------------------------
  //
  // Synthesis runs ALONGSIDE writing rather than after it. She streams tokens;
  // each completed sentence is sent for synthesis immediately, so the first
  // audio plays while she is still on the second paragraph.
  //
  // Deliberately fire-and-forget: a synthesis that is slow, refused, or failing
  // must never hold up the text, which is the product. Voice is the upgrade.
  const speech = {
    requested: options.voice === true,
    sentences: 0,
    charactersSynthesized: 0,
    charactersFromCache: 0,
    refusedReason: null as string | null,
    audioKeys: [] as string[],
  };

  const splitter = new SentenceSplitter();
  const pendingAudio: Promise<void>[] = [];
  let audioIndex = 0;

  const speakSentence = (sentence: string): void => {
    const text = speakable(sentence);
    if (!text) return;

    // Once refused, stop asking. A ceiling that is tripped stays tripped for
    // the day, and re-asking per sentence is the retry loop it exists to stop.
    if (speech.refusedReason) return;

    const index = audioIndex;
    audioIndex += 1;

    pendingAudio.push(
      synthesize(text, String(userId))
        .then((result) => {
          if (!result) return;

          if (result.refusedReason) {
            speech.refusedReason = result.refusedReason;
            progress({ type: "audio-unavailable", reason: result.refusedReason });
            return;
          }

          speech.sentences += 1;
          speech.audioKeys.push(result.s3Key);
          if (result.cached) speech.charactersFromCache += result.characters;
          else speech.charactersSynthesized += result.characters;

          progress({
            type: "audio",
            url: result.url,
            text,
            cached: result.cached,
            index,
          });
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: error instanceof Error ? error.message : error },
            "sentence synthesis failed; the turn continues in text",
          );
        }),
    );
  };

  const originalOnToken = options.onToken;

  const onToken = speech.requested
    ? (delta: string): void => {
        originalOnToken?.(delta);
        for (const sentence of splitter.push(delta)) speakSentence(sentence);
      }
    : originalOnToken;

  const voiceOptions: TurnOptions = { ...options, onToken };
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
      citationCapRegenerated: false,
      // Crisis resources are NOT read aloud. The written response exists so the
      // app gets out of the way; a synthesized voice reading a hotline number
      // to someone in crisis is the app inserting itself again.
      speech: {
        requested: false,
        sentences: 0,
        charactersSynthesized: 0,
        charactersFromCache: 0,
        refusedReason: null,
        audioKeys: [],
      },
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
  progress({ type: "premise" });
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
    progress({ type: "searching", query: preSearchQuery });
    const seeded = await searchScriptureTool({ query: preSearchQuery }, toolContext);
    if (seeded.citations.length > 0) {
      preSearched = seeded.resultSummary;
      retrievedFromPreSearch.push(...seeded.citations.map((c) => c.ref));
      progress({
        type: "found",
        references: seeded.citations.map((c) => c.ref),
      });
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

      // STREAMED, ALWAYS.
      //
      // One code path rather than two: a caller without onToken simply ignores
      // the deltas, and the assembled message is identical to what the
      // non-streaming call returned. `include_usage` keeps cost reporting
      // intact, which a naive switch to streaming silently loses.
      //
      // Which round writes the reply is not knowable in advance — she answers
      // whenever she stops calling tools — so every round streams and the
      // tool-call rounds simply emit no text.
      const stream = await getClient().chat.completions.create({
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
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = "";
      let announcedWriting = false;
      const partialCalls: {
        id: string;
        name: string;
        arguments: string;
      }[] = [];
      let usage: { prompt_tokens?: number; completion_tokens?: number } | null =
        null;

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          // The first text delta is the moment she starts writing, which is
          // what a waiting person actually needs to see.
          if (!announcedWriting) {
            announcedWriting = true;
            progress({ type: "writing" });
          }
          content += delta.content;
          try {
            voiceOptions.onToken?.(delta.content);
          } catch {
            // A disconnected client must not fail the turn.
          }
        }

        // Tool calls arrive in fragments and are assembled by index.
        for (const part of delta.tool_calls ?? []) {
          const at = part.index;
          partialCalls[at] ??= { id: "", name: "", arguments: "" };
          const slot = partialCalls[at];
          if (!slot) continue;
          if (part.id) slot.id = part.id;
          if (part.function?.name) slot.name += part.function.name;
          if (part.function?.arguments) slot.arguments += part.function.arguments;
        }
      }

      modelMs = Date.now() - modelStartedAt;

      costs.push({
        model: chosenModel,
        tokensIn: usage?.prompt_tokens ?? 0,
        tokensOut: usage?.completion_tokens ?? 0,
      });

      const assembled = partialCalls.filter((c) => c.name);

      const message: OpenAI.Chat.ChatCompletionMessageParam = {
        role: "assistant",
        content: content || null,
        ...(assembled.length > 0
          ? {
              tool_calls: assembled.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      };

      messages.push(message);

      const calls = assembled.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      }));

      if (calls.length === 0) {
        roundTimings.push({
          round: roundsUsed,
          modelMs,
          toolMs: 0,
          localMs: Math.max(0, Date.now() - roundStartedAt - modelMs),
          tools: [],
        });

        return {
          reply: content,
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

        // WHAT SHE IS ACTUALLY DOING, named from the arguments she chose.
        // Every one of these corresponds to work about to happen; none is a
        // placeholder and none is on a timer.
        try {
          const args = JSON.parse(call.function.arguments) as {
            query?: string;
            reference?: string;
          };

          if (call.function.name === "search_scripture") {
            progress({ type: "searching", query: args.query ?? "" });
          } else if (call.function.name === "get_passage" && args.reference) {
            progress({ type: "reading", reference: args.reference });
          } else if (call.function.name === "get_author_context") {
            progress({ type: "author", name: args.reference ?? "" });
          } else if (call.function.name === "offer_carrying" && args.reference) {
            progress({ type: "choosing", reference: args.reference });
          }
        } catch {
          // Malformed arguments are the tool layer's problem, not progress's.
        }

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

        if (
          invocation.name === "search_scripture" &&
          invocation.citations.length > 0
        ) {
          progress({
            type: "found",
            references: invocation.citations.map((c) => c.ref),
          });
        }

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
  let citationCapRegenerated = false;
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
  const groundingInputFor = (
    a: typeof attempt,
  ): { reply: string; retrievedReferences: string[]; toolCallCount: number } => ({
    reply: a.reply,
    // Pre-searched passages count on BOTH axes. She was handed them by a real
    // tool call, so citing one is grounded, and a turn that needed no further
    // search is the pre-search working rather than a reply with nothing behind
    // it. The first check was missing this and the second had it, which meant a
    // pre-search-only turn was regenerated for no reason.
    retrievedReferences: [...a.retrievedReferences, ...retrievedFromPreSearch],
    toolCallCount: a.toolCalls.length + retrievedFromPreSearch.length,
  });

  let verdict = checkGrounding(groundingInputFor(attempt));

  if (!verdict.grounded || emptyReply) {
    if (!verdict.grounded) logGroundingFailure(verdict, 1);
    regenerated = true;
    // Tokens for the discarded reply have already reached the client.
    progress({ type: "restart", reason: "grounding" });

    attempt = await runReasoning(
      emptyReply
        ? "You called tools but never wrote an answer. You have enough now. Write your reply to them, citing only references the tools returned."
        : `YOUR PREVIOUS ANSWER FAILED THE GROUNDING CHECK: ${verdict.reason} ` +
            "Call search_scripture or get_passage, and cite only references those tools returned. " +
            "Do not cite anything from memory.",
    );

    verdict = checkGrounding(groundingInputFor(attempt));

    if (!verdict.grounded || !attempt.reply.trim()) {
      logGroundingFailure(verdict, 2);
      fellBack = true;
      attempt.reply = GROUNDING_FALLBACK;
    }
  }

  // ---- 5b. CITATION CAP ----------------------------------------------------
  //
  // THE PROMPT LINE IS NOT WHAT HOLDS THIS. She was told "at most two passages,
  // normally one" and obeyed it four times in five; the fifth reply announced
  // "Two pieces of Scripture" and then cited three. A rule that holds four
  // times in five is a suggestion, and scenario 11 was passing by luck.
  //
  // Same shape as the grounding check above: regenerate ONCE, then accept.
  // Deliberately NOT a hard failure — a reply carrying three passages is
  // off-brand, not harmful, and GROUNDING_FALLBACK in its place would be worse
  // for the person reading it. The warning log is how a drift shows up.
  if (!fellBack) {
    const referenced = referencedPassages(attempt.reply);

    if (referenced.length > MAX_PASSAGES_IN_REPLY) {
      logger.warn(
        { referenced, count: referenced.length, cap: MAX_PASSAGES_IN_REPLY },
        "reply exceeded the passage cap; regenerating once",
      );

      citationCapRegenerated = true;
      progress({ type: "restart", reason: "too many passages" });

      attempt = await runReasoning(
        `Your previous answer referenced ${referenced.length} passages: ` +
          `${referenced.join(", ")}. That is a reading list, not something a ` +
          "person can sit with. Rewrite it around ONE passage — two only if the " +
          "second does genuinely different work — and say why you chose that " +
          "one. Do not name the others at all.",
      );

      // Regenerating can break grounding, so it is rechecked rather than assumed.
      verdict = checkGrounding(groundingInputFor(attempt));

      if (!verdict.grounded || !attempt.reply.trim()) {
        logGroundingFailure(verdict, 2);
        fellBack = true;
        attempt.reply = GROUNDING_FALLBACK;
      } else {
        const after = referencedPassages(attempt.reply);
        if (after.length > MAX_PASSAGES_IN_REPLY) {
          // Accepted anyway. One regeneration is the budget; a second would
          // cost another 20 seconds to fix something nobody is harmed by.
          logger.warn(
            { referenced: after, count: after.length },
            "reply STILL over the passage cap after regenerating — accepting it",
          );
        }
      }
    }
  }

  // The last sentence usually has no trailing whitespace to trigger a boundary,
  // so it is flushed explicitly or the closing line is never spoken.
  if (speech.requested) {
    const tail = splitter.flush();
    if (tail) speakSentence(tail);
    // Settle before returning: the caller reports what voice cost, and a
    // promise still in flight is a number that is wrong.
    await Promise.allSettled(pendingAudio);
  }

  // A PASSAGE SHE QUOTED FROM THE PRE-SEARCH IS STILL A CITATION.
  //
  // `attempt.citations` only collects tool invocations, so once the pre-search
  // existed a turn that used the seeded candidates and never called a tool
  // reported citing nothing — the gate read it as scripture deferred, and the
  // API returned an empty citations array to the client for a reply that quotes
  // Matthew 5:23-24 in full.
  const citedInReply = new Set(referencedPassages(attempt.reply));

  const preSearchCitations = retrievedFromPreSearch
    .filter((ref) => {
      const key = referencedPassages(ref)[0];
      return key !== undefined && citedInReply.has(key);
    })
    .filter((ref) => !attempt.citations.some((c) => c.ref === ref))
    .map((ref) => ({ ref, passageId: null }));

  return {
    reply: attempt.reply || GROUNDING_FALLBACK,
    safetyIntercepted: false,
    safetyClassification: "none",
    premiseVerdict: premise.verdict,
    premise: premise.premise,
    citations: [...attempt.citations, ...preSearchCitations],
    toolCalls: attempt.toolCalls,
    modelUsed: chosenModel,
    costs,
    latencyMs: Date.now() - startedAt,
    grounded: verdict.grounded && !fellBack,
    regenerated,
    fellBack,
    citationCapRegenerated,
    speech: {
      requested: speech.requested,
      sentences: speech.sentences,
      charactersSynthesized: speech.charactersSynthesized,
      charactersFromCache: speech.charactersFromCache,
      refusedReason: speech.refusedReason,
      audioKeys: speech.audioKeys,
    },
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
