// Model-level guarantees that do not need a database connection.
//
// Mongoose validates and serializes on the document, so `new Model({...})` is
// enough to exercise the rules that matter most here.

import { describe, expect, it } from "vitest";

import { AuthorModel, HymnModel, PassageModel } from "../models";

describe("passage serialization", () => {
  it("NEVER exposes the embedding", () => {
    // The Pepta /home failure mode, with a bigger blast radius: `embedding` is a
    // multi-hundred-float array on the hottest read path in the app. The
    // omission is declared on the MODEL so every call site inherits it.
    const passage = new PassageModel({
      reference: "Psalms 23:1-6",
      bookSlug: "psalms",
      chapter: 23,
      startVerse: 1,
      endVerse: 6,
      endChapter: 23,
      texts: new Map([["translation-id", "The Lord is my shepherd."]]),
      embedding: Array.from({ length: 1536 }, () => 0.0123),
      embeddingModel: "text-embedding-3-small",
    });

    const json = passage.toJSON() as Record<string, unknown>;

    expect(json.embedding).toBeUndefined();
    expect(json.embeddingModel).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("0.0123");
  });

  it("converts _id to id and serializes the texts map", () => {
    const passage = new PassageModel({
      reference: "Ephesians 2:8-10",
      bookSlug: "ephesians",
      chapter: 2,
      startVerse: 8,
      endVerse: 10,
      endChapter: 2,
      texts: new Map([["abc123", "For by grace."]]),
    });

    const json = passage.toJSON() as Record<string, unknown>;

    expect(json.id).toBeDefined();
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.texts).toEqual({ abc123: "For by grace." });
  });
});

describe("hymn serialization", () => {
  it("also omits the embedding", () => {
    const hymn = new HymnModel({
      title: "Nearer, My God, to Thee",
      author: "Sarah Flower Adams",
      year: 1841,
      isPublicDomain: true,
      stanzas: ["Nearer, my God, to Thee"],
      embedding: [0.5],
    });

    expect((hymn.toJSON() as Record<string, unknown>).embedding).toBeUndefined();
  });
});

describe("licensing guard", () => {
  it("refuses a post-1929 hymn marked public domain", async () => {
    // ARCHITECTURE.md §5: modern worship lyrics are owned by publishers even as
    // text. The mistake this catches is a modern song added with the flag left
    // true because every row above it was true.
    const hymn = new HymnModel({
      title: "A Modern Worship Song",
      author: "Someone Living",
      year: 2015,
      isPublicDomain: true,
      stanzas: ["..."],
    });

    await expect(hymn.validate()).rejects.toThrow(/PRE-1929/);
  });

  it("allows a genuine public-domain hymn", async () => {
    const hymn = new HymnModel({
      title: "Amazing Grace",
      author: "John Newton",
      year: 1779,
      isPublicDomain: true,
      stanzas: ["Amazing grace, how sweet the sound"],
    });

    await expect(hymn.validate()).resolves.toBeUndefined();
  });
});

describe("attribution honesty", () => {
  it("refuses contested authorship with no explanation", async () => {
    // A disputed author with no note is a claim with the evidence quietly
    // removed. Enforced in the schema, not the seed script, because the rule is
    // about what may exist in the database at all.
    const author = new AuthorModel({
      slug: "author-of-hebrews",
      name: "The author of Hebrews",
      era: "c. AD 60-90",
      bookSlugs: ["hebrews"],
      bio: "An unnamed writer.",
      circumstances: "Writing to people under pressure.",
      attribution: "unknown",
    });

    await expect(author.validate()).rejects.toThrow(/attributionNote/);
  });

  it("accepts contested authorship that explains itself", async () => {
    const author = new AuthorModel({
      slug: "author-of-hebrews",
      name: "The author of Hebrews",
      era: "c. AD 60-90",
      bookSlugs: ["hebrews"],
      bio: "An unnamed writer.",
      circumstances: "Writing to people under pressure.",
      attribution: "unknown",
      attributionNote: "Nobody knows who wrote Hebrews.",
    });

    await expect(author.validate()).resolves.toBeUndefined();
  });

  it("does not require a note when attribution is traditional", async () => {
    const author = new AuthorModel({
      slug: "paul",
      name: "Paul",
      era: "c. AD 48-67",
      bookSlugs: ["philippians"],
      bio: "He supervised the execution of Christians before he was one.",
      circumstances: "Much of what he wrote was written from custody.",
      attribution: "traditional",
    });

    await expect(author.validate()).resolves.toBeUndefined();
  });
});

describe("embedding presence is askable", () => {
  it("a new passage has NO embedding field at all", () => {
    // Mongoose gives every array path an implicit `[]` default. Without
    // `default: undefined` on the schema, an unembedded passage is written with
    // `embedding: []`, and `{ embedding: { $exists: false } }` — half the
    // backfill's selector — silently matches nothing.
    const passage = new PassageModel({
      reference: "Jude 1:3",
      bookSlug: "jude",
      chapter: 1,
      startVerse: 3,
      endVerse: 3,
      endChapter: 1,
      texts: new Map([["t", "Contend earnestly for the faith."]]),
    });

    expect(passage.embedding).toBeUndefined();
    expect(passage.toObject()).not.toHaveProperty("embedding");
  });

  it("a new hymn likewise", () => {
    const hymn = new HymnModel({
      title: "Rock of Ages",
      author: "Augustus Toplady",
      year: 1763,
      isPublicDomain: true,
      stanzas: ["Rock of Ages, cleft for me"],
    });

    expect(hymn.embedding).toBeUndefined();
  });
});
