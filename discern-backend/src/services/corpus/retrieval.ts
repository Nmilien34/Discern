// Hybrid retrieval over passages and hymns.
//
// ARCHITECTURE.md §7 makes this the input to every one of Abigail's
// search_scripture calls, and retrieval quality is the product: a wrong passage
// is not a degraded answer, it is the wrong words handed to someone in the middle
// of something.
//
// HYBRID, because neither half is sufficient alone:
//
//   VECTOR   catches meaning the words do not carry. "I feel far from God" shares
//            no vocabulary with "My God, my God, why have you forsaken me?"
//   KEYWORD  catches the specific thing a person names. Someone who says
//            "mustard seed" wants THAT passage, and a semantic search will
//            cheerfully return something adjacent and more general.
//
// Fused with Reciprocal Rank Fusion rather than by blending scores. RRF uses only
// the RANK from each side, which is what makes it safe here: cosine similarity
// and Mongo's textScore are on different, unnormalised scales, and any weighted
// sum of them silently lets whichever scale happens to be larger dominate.

import type { PassageResponse } from "@discern/shared";
import { bookBySlug } from "@discern/shared";
import mongoose from "mongoose";
import type { PipelineStage, Types } from "mongoose";

import { embeddingDimensions, models } from "../../config/models";
import { logger } from "../../lib/logger";
import { AuthorModel, HymnModel, PassageModel, TranslationModel } from "../../models";
import { embedQuery } from "./embeddings";
import { rewriteQueryForRetrieval } from "./query-rewrite";

/**
 * Passages and hymns are structurally identical for retrieval: both carry an
 * `embedding`, a `searchText` and the same filter fields. TypeScript cannot call
 * a method on a union of two Model types, and generic-ing the helpers over both
 * document shapes adds noise without adding safety here — the queries only ever
 * touch fields both models share.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SearchableModel = mongoose.Model<any>;

const PASSAGE_INDEX = "passages_vector";
const PASSAGE_INDEX_ENRICHED = "passages_vector_enriched";
const HYMN_INDEX = "hymns_vector";

/**
 * RRF constant. 60 is the value from the original paper and the usual default.
 *
 * It damps the top ranks so a single side cannot dominate on its own: the
 * difference in contribution between rank 1 and rank 2 is small, while the
 * difference between appearing and not appearing at all is large.
 */
const RRF_K = 60;

/**
 * Words that carry no retrieval signal in a conversational sentence.
 *
 * Mongo's $text OR-matches every term, so on "faith is something I have to
 * build myself" it scores documents for "build", "something" and "myself" —
 * which is how the passage that actually answers the sentence landed at keyword
 * rank 113 while Hebrews 11 was promoted for repeating "faith".
 */
const STOPWORDS = new Set([
  "a","about","after","again","all","am","an","and","any","anyone","are","as","at",
  "back","be","because","been","before","being","but","by","can","cant","could",
  "did","do","does","doesnt","doing","dont","enough","even","ever","every",
  "everyone","feel","feels","felt","for","from","get","got","had","has","have",
  "he","her","here","him","his","how","i","if","im","in","into","is","isnt","it",
  "its","ive","just","keep","know","let","like","lot","make","me","more","most",
  "much","my","myself","never","no","not","now","of","off","on","one","only","or",
  "other","our","out","over","own","really","said","same","say","she","should",
  "shouldnt","so","some","someone","something","still","such","than","that","the",
  "their","them","then","there","these","they","thing","things","think","this",
  "those","to","too","up","us","very","want","wanted","was","way","we","well",
  "went","were","what","when","where","which","while","who","why","will","with",
  "would","you","your","about","around","again","anymore",
]);

/**
 * Should the keyword half run for this query?
 *
 * MEASURED, not assumed. Across the 15 gate queries the keyword half found a
 * result the vector half also found in only 17 of 45 cases, and on conversational
 * input it actively retrieved on stopword collisions — "I have money but I'm
 * still afraid" returned Genesis 43 (money in sacks); "everyone at church seems
 * more sure than me" returned 2 Peter ("make your calling and election sure").
 *
 * Keyword search is valuable for exactly one shape of query: one where the person
 * NAMES something specific — a reference, a quoted line, a proper noun, or an
 * unusual word. So it runs when there is such a term, and stays out of the way
 * when the query is somebody describing how they feel.
 */
export function keywordTermsFor(query: string): string[] {
  const quoted = [...query.matchAll(/"([^"]{3,})"|'([^']{6,})'/g)]
    .map((m) => m[1] ?? m[2] ?? "")
    .filter(Boolean);

  if (quoted.length > 0) return quoted;

  const words = query.split(/[^A-Za-z0-9'’-]+/).filter(Boolean);
  const distinctive: string[] = [];

  words.forEach((word, index) => {
    const bare = word.replace(/['’]/g, "").toLowerCase();
    if (bare.length < 4 || STOPWORDS.has(bare)) return;

    // A capitalised word that is not sentence-initial is a name or a title —
    // "Nathan", "Philippians", "Gethsemane" — and is exactly what keyword search
    // is good at.
    const isProperNoun = index > 0 && /^[A-Z]/.test(word);
    // Long words are rarely stopwords and tend to be the content of the query.
    const isSubstantive = bare.length >= 7;

    if (isProperNoun || isSubstantive) distinctive.push(word);
  });

  return distinctive;
}

export interface SearchOptions {
  stageSlug?: string;
  authorId?: string;
  situation?: string;
  bookSlug?: string;
  limit?: number;
  /** Abbreviation. Defaults to the default translation. */
  translation?: string;
  /**
   * Search the enrichment-augmented vector instead of the raw passage text.
   *
   * DEFAULTS OFF, and that is a measurement result rather than an oversight.
   * Across the 15 gate queries in four configurations, the enriched vector
   * FAILED the gate both on its own and combined with query rewriting, while
   * rewriting alone passed. Enrichment stays in the database as Phase 6 safety
   * metadata (`handling`, `cautions`); it is not in the retrieval path.
   * See DEFERRED.md item 3 for the one experiment worth running later.
   */
  useEnriched?: boolean;
  /**
   * Rewrite the query into hypothetical passage-shaped text before embedding.
   *
   * DEFAULTS ON. This is the shipped configuration: it was the only one of four
   * to put Ephesians 2:8-10 in the top 3 for "faith is something I have to build
   * myself", and it lifted stage-tagged results from 24/45 to 33/45.
   *
   * Costs one cheap model call per search. Pass `false` to skip it where latency
   * matters more than recall.
   */
  rewriteQuery?: boolean;
}

export interface ScoredPassage {
  passage: PassageResponse;
  score: number;
  /** Which half found it, for judging retrieval from the CLI. */
  matchedBy: ("vector" | "keyword")[];
  vectorRank?: number;
  keywordRank?: number;
}

let vectorSearchAvailable: boolean | null = null;

/**
 * Whether this deployment can run `$vectorSearch`.
 *
 * Probed once and cached. Local `mongod` cannot — the stage is Atlas-only — and
 * the fallback below exists so retrieval can still be judged in development.
 */
async function isVectorSearchAvailable(): Promise<boolean> {
  if (vectorSearchAvailable !== null) return vectorSearchAvailable;


  try {
    // THE PROBE VECTOR MUST BE THE RIGHT WIDTH AND MUST NOT BE ALL ZEROS.
    //
    // A 1-element [0] probe seems harmless and is not: Atlas rejects it with
    // "vector field is indexed with 3072 dimensions but queried with 1", the
    // catch below reads any failure as "not Atlas", and retrieval silently drops
    // to the in-process fallback FOREVER — on a cluster where $vectorSearch was
    // available and READY the whole time. It stayed hidden because the fallback
    // returns correct results (exact KNN is more accurate than approximate
    // search, just far slower), so the only symptom was 22-second queries.
    //
    // Sizing it correctly is not enough either: an all-zero vector of the right
    // width is ALSO rejected, with "Cosine similarity cannot be calculated
    // against a zero vector". The probe therefore has to be a real direction —
    // any non-zero vector will do, and its results are discarded.
    const probeVector = new Array(embeddingDimensions()).fill(0);
    probeVector[0] = 1;

    await PassageModel.aggregate([
      {
        $vectorSearch: {
          index: PASSAGE_INDEX,
          path: "embedding",
          queryVector: probeVector,
          numCandidates: 1,
          limit: 1,
        },
      },
    ]);
    vectorSearchAvailable = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "only allowed on MongoDB Atlas" is the local case. An index that merely
    // does not exist yet is a different, recoverable problem, but both mean the
    // Atlas path cannot serve this query right now.
    vectorSearchAvailable = false;
    logger.warn(
      { reason: message.slice(0, 160) },
      "$vectorSearch unavailable — falling back to exact in-process cosine " +
        "similarity. Correct but slow, and NOT a production path. See " +
        "src/db/search-indexes/README.md",
    );
  }

  return vectorSearchAvailable;
}

/** Cosine similarity. Vectors from the same model share a width. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

interface FilterSpec {
  stageSlugs?: string;
  situations?: string;
  bookSlug?: string;
  authorId?: Types.ObjectId;
}

function buildFilter(options: SearchOptions): FilterSpec {
  const filter: FilterSpec = {};
  if (options.stageSlug) filter.stageSlugs = options.stageSlug;
  if (options.situation) filter.situations = options.situation;
  if (options.bookSlug) filter.bookSlug = options.bookSlug;
  if (options.authorId && mongoose.isValidObjectId(options.authorId)) {
    filter.authorId = new mongoose.Types.ObjectId(options.authorId);
  }
  return filter;
}

interface ScoredId {
  id: string;
  /** Cosine similarity. Used to break RRF ties deterministically. */
  score: number;
}

/** Vector half. Returns document ids in rank order, with their similarity. */
async function vectorSearchIds(
  queryVector: number[],
  filter: FilterSpec,
  limit: number,
  model: SearchableModel,
  indexName: string,
  vectorPath = "embedding",
): Promise<ScoredId[]> {
  if (await isVectorSearchAvailable()) {
    const stage: PipelineStage = {
      $vectorSearch: {
        index: indexName,
        path: vectorPath,
        queryVector,
        // Oversample: the engine explores numCandidates and returns `limit`.
        // 20x is the usual guidance and matters more once filters are applied.
        numCandidates: Math.max(limit * 20, 150),
        limit,
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
      },
    } as PipelineStage;

    const results = await model.aggregate([
      stage,
      { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
    ]);
    return results.map((doc: { _id: unknown; score: number }) => ({
      id: String(doc._id),
      score: doc.score,
    }));
  }

  // ---- Local fallback: exact KNN in process --------------------------------
  //
  // Correct, and more accurate than approximate search — but it reads every
  // embedding into memory. Development only; see the README.
  // Selects on embeddingModel, NOT on `embedding: { $exists: true }`. The
  // latter is true even for a document that was never embedded (Mongoose writes
  // `[]` for an array path), which would drag every unembedded passage through
  // the cosine loop to score 0.
  const modelField =
    vectorPath === "embedding" ? "embeddingModel" : "embeddingEnrichedModel";

  const candidates = await model
    .find({ [modelField]: models.embedding, ...filter })
    .select(`_id ${vectorPath}`)
    .lean();

  const scored: { id: string; score: number }[] = candidates.map(
    (doc: Record<string, unknown>) => {
      const vector = doc[vectorPath] as number[] | undefined;
      return {
        id: String(doc._id),
        score: vector ? cosine(queryVector, vector) : -1,
      };
    },
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Keyword half, via the Mongo text index. Portable to local and Atlas alike. */
async function keywordSearchIds(
  query: string,
  filter: FilterSpec,
  limit: number,
  model: SearchableModel,
): Promise<string[]> {
  // Fix 2: skip the keyword half entirely when the query names nothing specific.
  if (keywordTermsFor(query).length === 0) return [];

  try {
    const results = await model
      .find(
        { $text: { $search: query }, ...filter },
        { score: { $meta: "textScore" } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .select("_id")
      .lean();

    return results.map((doc: { _id: unknown }) => String(doc._id));
  } catch (error) {
    // A missing text index must not take retrieval down: the vector half alone
    // is still a usable answer.
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "keyword search failed; continuing with vector results only",
    );
    return [];
  }
}

interface FusedEntry {
  score: number;
  vectorRank?: number;
  keywordRank?: number;
  /** Cosine, carried through purely to break ties. */
  vectorScore?: number;
}

/**
 * Reciprocal Rank Fusion, with ties broken by cosine similarity.
 *
 * THE TIE-BREAK IS FIX 3, and it is not cosmetic. When the two halves surface
 * disjoint sets — which happened on 7 of the 15 gate queries — every result is
 * rank 1 in exactly one list and therefore scores exactly 1/(60+1). Twenty of
 * forty-five results tied at that value, and their order was whatever the Map
 * happened to iterate. Falling back to the vector score makes the ordering mean
 * something; falling back to the id after that makes it reproducible.
 */
function fuse(
  vectorIds: ScoredId[],
  keywordIds: string[],
): Map<string, FusedEntry> {
  const fused = new Map<string, FusedEntry>();

  vectorIds.forEach((entry, index) => {
    const existing = fused.get(entry.id) ?? { score: 0 };
    existing.score += 1 / (RRF_K + index + 1);
    existing.vectorRank = index + 1;
    existing.vectorScore = entry.score;
    fused.set(entry.id, existing);
  });

  keywordIds.forEach((id, index) => {
    const existing = fused.get(id) ?? { score: 0 };
    existing.score += 1 / (RRF_K + index + 1);
    existing.keywordRank = index + 1;
    fused.set(id, existing);
  });

  return fused;
}

/** RRF score, then cosine, then id — so equal scores never order arbitrarily. */
function compareFused(
  a: [string, FusedEntry],
  b: [string, FusedEntry],
): number {
  if (b[1].score !== a[1].score) return b[1].score - a[1].score;
  const aScore = a[1].vectorScore ?? -1;
  const bScore = b[1].vectorScore ?? -1;
  if (bScore !== aScore) return bScore - aScore;
  return a[0].localeCompare(b[0]);
}

async function hydratePassages(
  ids: string[],
  translationAbbreviation?: string,
): Promise<Map<string, PassageResponse>> {
  const translation =
    (translationAbbreviation
      ? await TranslationModel.findOne({
          abbreviation: translationAbbreviation.toUpperCase(),
        })
      : null) ??
    (await TranslationModel.findOne({ isDefault: true })) ??
    (await TranslationModel.findOne());

  if (!translation) {
    throw new Error("No translations seeded; cannot hydrate retrieval results.");
  }

  const passages = await PassageModel.find({ _id: { $in: ids } });
  const authorIds = passages
    .map((passage) => passage.authorId)
    .filter((id): id is Types.ObjectId => id !== null);
  const authors = await AuthorModel.find({ _id: { $in: authorIds } });
  const authorById = new Map(authors.map((author) => [String(author._id), author]));

  const result = new Map<string, PassageResponse>();

  for (const passage of passages) {
    const meta = bookBySlug(passage.bookSlug);
    const author = passage.authorId
      ? authorById.get(String(passage.authorId))
      : undefined;

    const text =
      passage.texts.get(String(translation._id)) ??
      [...passage.texts.values()][0] ??
      "";

    result.set(String(passage._id), {
      id: String(passage._id),
      reference: passage.reference,
      bookSlug: passage.bookSlug,
      bookName: meta?.name ?? passage.bookSlug,
      chapter: passage.chapter,
      startVerse: passage.startVerse,
      endVerse: passage.endVerse,
      endChapter: passage.endChapter,
      translation: {
        id: String(translation._id),
        abbreviation: translation.abbreviation,
        name: translation.name,
        licenseType: translation.licenseType,
        copyrightNotice: translation.copyrightNotice,
        isDefault: translation.isDefault,
      },
      text,
      // Retrieval returns the passage as a unit; per-verse breakdown is a read
      // concern and would triple the payload of every tool result.
      verses: [],
      author: author
        ? {
            id: String(author._id),
            slug: author.slug,
            name: author.name,
            era: author.era,
            attribution: author.attribution,
            ...(author.attributionNote
              ? { attributionNote: author.attributionNote }
              : {}),
            bookSlugs: author.bookSlugs,
          }
        : null,
      themes: passage.themes,
      stageSlugs: passage.stageSlugs,
      situations: passage.situations,
      ...(passage.textualNote ? { textualNote: passage.textualNote } : {}),
      ...(passage.summary ? { summary: passage.summary } : {}),
    });
  }

  return result;
}

/**
 * ARCHITECTURE.md §7: `search_scripture(query, { stageSlug?, authorId?, situation? })`.
 */
export async function searchScripture(
  query: string,
  options: SearchOptions = {},
): Promise<ScoredPassage[]> {
  const limit = options.limit ?? 10;
  const filter = buildFilter(options);

  // Oversample each half so fusion has something to work with: a document
  // ranked 8th by vectors and 9th by keywords should beat one ranked 1st by
  // only one of them, and that cannot happen if each side only returns `limit`.
  const perSide = Math.max(limit * 3, 20);

  // HyDE runs BEFORE embedding and only affects the vector half. The keyword
  // half keeps the user's actual words: rewritten text is hypothetical, and
  // keyword-matching invented prose would retrieve on words nobody said.
  const embedText =
    options.rewriteQuery ?? true
      ? await rewriteQueryForRetrieval(query)
      : query;

  const queryVector = await embedQuery(embedText);

  const [vectorIds, keywordIds] = await Promise.all([
    vectorSearchIds(
      queryVector,
      filter,
      perSide,
      PassageModel,
      options.useEnriched ? PASSAGE_INDEX_ENRICHED : PASSAGE_INDEX,
      options.useEnriched ? "embeddingEnriched" : "embedding",
    ),
    keywordSearchIds(query, filter, perSide, PassageModel),
  ]);

  const fused = fuse(vectorIds, keywordIds);
  const ranked = [...fused.entries()].sort(compareFused).slice(0, limit);

  const hydrated = await hydratePassages(
    ranked.map(([id]) => id),
    options.translation,
  );

  return ranked
    .map(([id, scoring]) => {
      const passage = hydrated.get(id);
      if (!passage) return null;

      const matchedBy: ("vector" | "keyword")[] = [];
      if (scoring.vectorRank !== undefined) matchedBy.push("vector");
      if (scoring.keywordRank !== undefined) matchedBy.push("keyword");

      return {
        passage,
        score: scoring.score,
        matchedBy,
        ...(scoring.vectorRank !== undefined
          ? { vectorRank: scoring.vectorRank }
          : {}),
        ...(scoring.keywordRank !== undefined
          ? { keywordRank: scoring.keywordRank }
          : {}),
      };
    })
    .filter((entry): entry is ScoredPassage => entry !== null);
}

export interface ScoredHymn {
  id: string;
  title: string;
  author: string;
  year: number;
  stanzas: string[];
  themes: string[];
  score: number;
  matchedBy: ("vector" | "keyword")[];
}

/** ARCHITECTURE.md §7: `search_hymns(query)`. */
export async function searchHymns(
  query: string,
  options: { limit?: number; stageSlug?: string } = {},
): Promise<ScoredHymn[]> {
  const limit = options.limit ?? 5;
  const filter = buildFilter({ ...(options.stageSlug ? { stageSlug: options.stageSlug } : {}) });
  const perSide = Math.max(limit * 3, 15);

  const total = await HymnModel.estimatedDocumentCount();
  if (total === 0) return [];

  const queryVector = await embedQuery(query);

  const [vectorIds, keywordIds] = await Promise.all([
    vectorSearchIds(queryVector, filter, perSide, HymnModel, HYMN_INDEX),
    keywordSearchIds(query, filter, perSide, HymnModel),
  ]);

  const fused = fuse(vectorIds, keywordIds);
  const ranked = [...fused.entries()].sort(compareFused).slice(0, limit);

  const hymns = await HymnModel.find({ _id: { $in: ranked.map(([id]) => id) } });
  const byId = new Map(hymns.map((hymn) => [String(hymn._id), hymn]));

  return ranked
    .map(([id, scoring]) => {
      const hymn = byId.get(id);
      if (!hymn) return null;

      const matchedBy: ("vector" | "keyword")[] = [];
      if (scoring.vectorRank !== undefined) matchedBy.push("vector");
      if (scoring.keywordRank !== undefined) matchedBy.push("keyword");

      return {
        id,
        title: hymn.title,
        author: hymn.author,
        year: hymn.year,
        stanzas: hymn.stanzas,
        themes: hymn.themes,
        score: scoring.score,
        matchedBy,
      };
    })
    .filter((entry): entry is ScoredHymn => entry !== null);
}

/**
 * Reports whether the vector index is usable. Called at worker startup.
 *
 * WARNS, never throws. The reader, author navigation, journey and carryings all
 * work without a vector index; only retrieval does not. Taking the whole service
 * down over it would disable the free half of the product to protect the paid
 * half. Corner's precedent, and the same reasoning.
 */
export async function reportVectorIndexStatus(): Promise<void> {
  const embedded = await PassageModel.countDocuments({
    embeddingModel: models.embedding,
  });
  const total = await PassageModel.estimatedDocumentCount();
  const available = await isVectorSearchAvailable();

  if (!available) {
    logger.warn(
      { embedded, total },
      "vector search is NOT available on this deployment — Abigail's retrieval " +
        "will use the in-process fallback. Everything else works normally.",
    );
    return;
  }

  if (embedded < total) {
    logger.warn(
      { embedded, total, model: models.embedding },
      "some passages are not embedded with the current model — run " +
        "`npm run embed`. Retrieval will simply not see them.",
    );
    return;
  }

  logger.info({ embedded, model: models.embedding }, "vector search ready");
}
