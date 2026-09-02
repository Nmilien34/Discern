// Abigail's tools (ARCHITECTURE.md §7).
//
// THE HARM FILTER LIVES HERE, and it is a DIFFERENT GATE from the safety
// classifier. The safety gate reads what the USER typed, before the turn. This
// reads what RETRIEVAL RETURNED, before Abigail sees it. docs/RETRIEVAL-HARM.md
// records why: "everyone at church seems more sure than me" carries no distress
// signal, passes any input classifier correctly, and still surfaced Leviticus
// 20:5-18 — a text about being cut off — at rank 2.
//
// Two mechanisms, both applied to every unprompted search:
//
//   1. `on-request-only` passages are REMOVED. Graphic violence, sexual
//      judgment texts, explicit erotic content, curses. Reachable when someone
//      asks for them by name via get_passage; never surfaced by a search.
//   2. `cautions` travel WITH the passage into Abigail's context, so she reads
//      why a passage can land wrong BEFORE deciding to hand it over.

import type { Types } from "mongoose";

import { logger } from "../../lib/logger";
import { parseReference } from "../../lib/reference";
import {
  AuthorModel,
  BookModel,
  CarryingModel,
  PassageModel,
  TranslationModel,
} from "../../models";
import { searchHymns, searchScripture } from "../corpus/retrieval";
import { addCarrying } from "../journey/carryings.service";
import { enterStage } from "../journey/stages.service";

export interface ToolContext {
  userId: Types.ObjectId;
  conversationId: Types.ObjectId;
  /** References already given to this person, so she does not repeat herself. */
  passagesAlreadyGiven: string[];
  /**
   * Where a search reports its own model spend.
   *
   * A search costs a HyDE rewrite and a query embedding on top of whatever the
   * reasoning model spends calling it. Both were missing from every cost figure
   * until 2026-09-02.
   */
  onUsage?: (usage: { model: string; tokensIn: number; tokensOut: number }) => void;
}

export interface ToolInvocation {
  name: string;
  arguments: string;
  resultSummary: string;
  /** Citations this call produced, for the grounding check. */
  citations: { ref: string; passageId: string | null }[];
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_scripture",
      description:
        "Search the Bible for passages that speak to a situation. Use the person's SITUATION as the query, in plain words, not a topic label. Returns the FULL TEXT of each passage, its author and their circumstances, and any cautions — everything you need to choose and quote. You should not need get_passage or get_author_context after this.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description:
              "What this person is actually facing, in plain words. e.g. 'I think I have to earn my way to God'",
          },
          stageSlug: {
            type: "string",
            enum: [
              "pride-humility",
              "greed-generosity",
              "lust-pure-love",
              "envy-gratitude",
              "gluttony-temperance",
              "wrath-patience",
              "sloth-diligence",
            ],
            description:
              "Optional. Narrow to passages that HELP someone working through this stage.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_passage",
      description:
        "Fetch a specific passage by reference, e.g. 'Ephesians 2:8-10'. Use when you already know which passage you mean, or when the person asked about one by name.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["reference"],
        properties: {
          reference: { type: "string" },
          translation: {
            type: "string",
            description: "Optional abbreviation, WEB or KJV. Defaults to WEB.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_author_context",
      description:
        "Who wrote a book, and what was happening to them when they wrote it. Use when the circumstances change how a passage reads — Philippians from a prison, Lamentations over a burned city.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["bookSlug"],
        properties: {
          bookSlug: {
            type: "string",
            description: "e.g. 'philippians', 'lamentations'",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_hymns",
      description: "Search public-domain hymns for something to sit with.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: { query: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "offer_carrying",
      description:
        "Give this person a passage to carry and return to. Use ONCE, near the end, for the one thing you want them to sit with. Say plainly why you are giving them this one.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["reference", "why"],
        properties: {
          reference: { type: "string" },
          why: {
            type: "string",
            description: "Why THIS passage for THIS person, in one sentence.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_stage",
      description:
        "Record that this person appears to be working through one of the seven stages. Only when the evidence is in what they actually said. Requires evidence.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["stageSlug", "evidence"],
        properties: {
          stageSlug: {
            type: "string",
            enum: [
              "pride-humility",
              "greed-generosity",
              "lust-pure-love",
              "envy-gratitude",
              "gluttony-temperance",
              "wrath-patience",
              "sloth-diligence",
            ],
          },
          evidence: {
            type: "string",
            description: "What they said that supports this. Quote or paraphrase.",
          },
        },
      },
    },
  },
];

interface RawArgs {
  query?: string;
  stageSlug?: string;
  situation?: string;
  authorId?: string;
  reference?: string;
  translation?: string;
  bookSlug?: string;
  why?: string;
  evidence?: string;
}

export async function executeTool(
  name: string,
  rawArguments: string,
  context: ToolContext,
): Promise<ToolInvocation> {
  let args: RawArgs = {};
  try {
    args = JSON.parse(rawArguments) as RawArgs;
  } catch {
    return {
      name,
      arguments: rawArguments,
      resultSummary: "ERROR: arguments were not valid JSON.",
      citations: [],
    };
  }

  switch (name) {
    case "search_scripture":
      return searchScriptureTool(args, context);
    case "get_passage":
      return getPassageTool(args);
    case "get_author_context":
      return getAuthorContextTool(args);
    case "search_hymns":
      return searchHymnsTool(args, context);
    case "offer_carrying":
      return offerCarryingTool(args, context);
    case "note_stage":
      return noteStageTool(args, context);
    default:
      return {
        name,
        arguments: rawArguments,
        resultSummary: `ERROR: no such tool "${name}".`,
        citations: [],
      };
  }
}

async function searchScriptureTool(
  args: RawArgs,
  context: ToolContext,
): Promise<ToolInvocation> {
  const baseOptions = {
    // Five rather than eight. Each result now carries full text, so eight would
    // triple the input tokens on every subsequent round for candidates she was
    // never going to use.
    limit: 5,
    // The configuration that passed the Phase 3 gate: HyDE rewriting on the raw
    // embedding. Enrichment is deliberately NOT in this path (DEFERRED.md).
    rewriteQuery: true,
    useEnriched: false,
    // Every search reports its HyDE and embedding spend up to the turn.
    ...(context.onUsage ? { onUsage: context.onUsage } : {}),
  };

  let results = await searchScripture(args.query ?? "", {
    ...baseOptions,
    ...(args.stageSlug ? { stageSlug: args.stageSlug } : {}),
  });

  // A FILTER THAT MATCHES NOTHING MUST NOT LOOK LIKE AN EMPTY BIBLE.
  //
  // Measured: she searched three times for a grieving user and got "No passages
  // found" every time, then told them she could not reach the text. The filter
  // was excluding everything — `situations` are enriched first-person sentences
  // ("I feel like I have to earn God's favor"), so any single-word value matches
  // zero passages, and `stageSlug` narrows to a few hundred. Retrying unfiltered
  // is always better than handing back nothing.
  if (results.length === 0 && args.stageSlug) {
    logger.info(
      { query: args.query, stageSlug: args.stageSlug },
      "filtered search returned nothing; retrying without the filter",
    );
    results = await searchScripture(args.query ?? "", { ...baseOptions, onUsage: context.onUsage });
  }

  const references = results.map((r) => r.passage.reference);
  const docs = await PassageModel.find({ reference: { $in: references } })
    .select("reference handling cautions summary")
    .lean();
  const meta = new Map(docs.map((d) => [d.reference, d]));

  // Author circumstances come back WITH the search, so get_author_context is a
  // follow-up she rarely needs. Measured: the search-then-read-then-read pattern
  // was costing a median of 7 reasoning rounds per turn, and every round spends
  // reasoning tokens whether or not it produces text.
  const authorIds = [
    ...new Set(
      results
        .map((r) => r.passage.author?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const authors = await AuthorModel.find({ _id: { $in: authorIds } })
    .select("name era circumstances attribution attributionNote")
    .lean();
  const authorById = new Map(authors.map((a) => [String(a._id), a]));

  const kept: string[] = [];
  const withheld: string[] = [];

  const lines = results.flatMap((result) => {
    const info = meta.get(result.passage.reference);

    // GATE 1: on-request-only never surfaces from a search.
    if (info?.handling === "on-request-only") {
      withheld.push(result.passage.reference);
      return [];
    }

    kept.push(result.passage.reference);

    const alreadyGiven = context.passagesAlreadyGiven.includes(
      result.passage.reference,
    );

    // GATE 2: cautions travel WITH the passage, so she reads why it can land
    // wrong before choosing it.
    const cautions = info?.cautions?.length
      ? `\n  CAUTION before giving this to anyone: ${info.cautions.join(" ")}`
      : "";
    const careFlag =
      info?.handling === "care"
        ? "\n  HANDLING: care — this needs framing before it lands well."
        : "";
    const repeat = alreadyGiven
      ? "\n  NOTE: you have already given this person this passage. Do not hand it over again."
      : "";

    const author = result.passage.author?.id
      ? authorById.get(result.passage.author.id)
      : undefined;

    const authorLine = author
      ? `\n  WRITER: ${author.name} (${author.era}) — ${author.circumstances}` +
        (author.attribution !== "traditional"
          ? ` [ATTRIBUTION ${author.attribution.toUpperCase()}: ${author.attributionNote ?? ""}]`
          : "")
      : "";

    return [
      `${result.passage.reference} (${result.passage.author?.name ?? "unknown"})` +
        // FULL TEXT, not a 400-character preview. The preview was what forced
        // her to call get_passage on every candidate to see what it said.
        `\n  ${result.passage.text}` +
        (info?.summary ? `\n  What it is: ${info.summary}` : "") +
        authorLine +
        careFlag +
        cautions +
        repeat,
    ];
  });

  if (withheld.length > 0) {
    logger.info(
      { withheld, query: args.query },
      "harm filter removed on-request-only passages from an unprompted search",
    );
  }

  return {
    name: "search_scripture",
    arguments: JSON.stringify(args),
    resultSummary:
      lines.length > 0
        ? lines.join("\n\n")
        : "No passages found. Try describing the situation differently.",
    citations: kept.map((ref) => ({ ref, passageId: null })),
  };
}

async function getPassageTool(args: RawArgs): Promise<ToolInvocation> {
  try {
    const parsed = parseReference(args.reference ?? "");
    const translation =
      (args.translation
        ? await TranslationModel.findOne({
            abbreviation: args.translation.toUpperCase(),
          })
        : null) ?? (await TranslationModel.findOne({ isDefault: true }));

    const passage = await PassageModel.findOne({ reference: parsed.canonical })
      .select("reference texts cautions handling summary textualNote")
      .lean();

    if (!passage) {
      return {
        name: "get_passage",
        arguments: JSON.stringify(args),
        resultSummary: `"${parsed.canonical}" is not a stored passage. It may sit inside a larger one.`,
        citations: [],
      };
    }

    const text =
      (passage.texts as unknown as Map<string, string>)?.get?.(
        String(translation?._id),
      ) ?? Object.values(passage.texts ?? {})[0];

    // NOTE: no on-request-only filter here. get_passage is the BY-NAME path —
    // someone asking for a specific passage should receive it. The filter exists
    // to stop unsolicited delivery, not to make scripture unreachable.
    return {
      name: "get_passage",
      arguments: JSON.stringify(args),
      resultSummary:
        `${passage.reference}\n${String(text ?? "")}` +
        (passage.textualNote ? `\n  TEXTUAL NOTE: ${passage.textualNote}` : "") +
        (passage.cautions?.length
          ? `\n  CAUTION: ${passage.cautions.join(" ")}`
          : ""),
      citations: [{ ref: passage.reference, passageId: String(passage._id) }],
    };
  } catch (error) {
    return {
      name: "get_passage",
      arguments: JSON.stringify(args),
      resultSummary: `ERROR: ${error instanceof Error ? error.message : "bad reference"}`,
      citations: [],
    };
  }
}

async function getAuthorContextTool(args: RawArgs): Promise<ToolInvocation> {
  const book = await BookModel.findOne({ slug: args.bookSlug }).lean();
  const author = book?.authorId
    ? await AuthorModel.findById(book.authorId).lean()
    : null;

  if (!author) {
    return {
      name: "get_author_context",
      arguments: JSON.stringify(args),
      resultSummary: `No author information for "${args.bookSlug ?? ""}".`,
      citations: [],
    };
  }

  return {
    name: "get_author_context",
    arguments: JSON.stringify(args),
    resultSummary:
      `${author.name} (${author.era})\n${author.bio}\n\nWhat was happening: ${author.circumstances}` +
      (author.attribution !== "traditional"
        ? `\n\nATTRIBUTION: ${author.attribution.toUpperCase()} — ${author.attributionNote ?? ""}`
        : ""),
    citations: [],
  };
}

async function searchHymnsTool(
  args: RawArgs,
  context: ToolContext,
): Promise<ToolInvocation> {
  const hymns = await searchHymns(args.query ?? "", {
    limit: 3,
    ...(context.onUsage ? { onUsage: context.onUsage } : {}),
  });

  return {
    name: "search_hymns",
    arguments: JSON.stringify(args),
    resultSummary: hymns.length
      ? hymns.map((h) => `${h.title} (${h.author}, ${h.year})`).join("\n")
      : "No hymns are in the corpus yet.",
    citations: [],
  };
}

async function offerCarryingTool(
  args: RawArgs,
  context: ToolContext,
): Promise<ToolInvocation> {
  try {
    const carrying = await addCarrying(context.userId, {
      kind: "passage",
      reference: args.reference ?? "",
      source: "abigail",
      ...(args.why ? { why: args.why } : {}),
    });

    return {
      name: "offer_carrying",
      arguments: JSON.stringify(args),
      resultSummary: `Given to them to carry: ${carrying.reference}.`,
      citations: [{ ref: carrying.reference ?? "", passageId: carrying.refId }],
    };
  } catch (error) {
    // The cap being reached is a normal, expected outcome, and she must be told
    // in words she can act on rather than an error code.
    const message = error instanceof Error ? error.message : "could not offer";
    return {
      name: "offer_carrying",
      arguments: JSON.stringify(args),
      resultSummary: `NOT GIVEN: ${message} Tell them what you wanted to give them and why, and that they would need to release something first.`,
      citations: [],
    };
  }
}

async function noteStageTool(
  args: RawArgs,
  context: ToolContext,
): Promise<ToolInvocation> {
  try {
    await enterStage(
      context.userId,
      args.stageSlug as never,
      // 'abigail', which the model requires evidence for — a stage named with no
      // reason is a diagnosis the person cannot question.
      "abigail",
      args.evidence ?? "",
    );

    return {
      name: "note_stage",
      arguments: JSON.stringify(args),
      resultSummary: `Noted: they appear to be working through ${args.stageSlug ?? ""}.`,
      citations: [],
    };
  } catch (error) {
    return {
      name: "note_stage",
      arguments: JSON.stringify(args),
      resultSummary: `Could not note the stage: ${
        error instanceof Error ? error.message : "unknown"
      }`,
      citations: [],
    };
  }
}

/** Active carryings, for context assembly. */
export async function activeCarryingsFor(
  userId: Types.ObjectId,
): Promise<{ reference: string; why: string | null; revisitCount: number }[]> {
  const carryings = await CarryingModel.find({ userId, releasedAt: null }).lean();
  const passages = await PassageModel.find({
    _id: { $in: carryings.map((c) => c.refId) },
  })
    .select("reference")
    .lean();
  const byId = new Map(passages.map((p) => [String(p._id), p.reference]));

  return carryings.map((c) => ({
    reference: byId.get(String(c.refId)) ?? "unknown",
    why: c.why,
    revisitCount: c.revisitCount,
  }));
}
