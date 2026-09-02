// Curated pericope boundaries.
//
// Where a natural unit is well established, it is written down here rather than
// left to a heuristic to rediscover. These are the units people already quote,
// teach and memorise as units — the ones where a boundary in the wrong place is
// immediately, obviously wrong to a reader.
//
// Every anchor passage named in ARCHITECTURE.md is here by construction: the
// put off / put on passages (Colossians 3:5-14, Ephesians 4:22-24) that the
// seven stages hang off, the brand chapter (Matthew 7), the mustard seed
// (Matthew 17:20, Matthew 13:31-32), and the go-and-be-reconciled passage
// Abigail uses to send someone out of the app (Matthew 5:23-24).
//
// Format: [startChapter, startVerse, endChapter, endVerse]. Cross-chapter
// entries are allowed and are the reason passages carry an endChapter.
//
// This table does not need to be exhaustive. Anything not covered falls through
// to the discourse-aware segmentation in services/corpus/segment.ts.

/**
 * `[startChapter, startVerse, endChapter, endVerse]`, with an optional fifth
 * element carrying a note that travels onto the passage itself.
 *
 * The note exists for one situation: a passage whose TEXT is disputed, as
 * distinct from a book whose AUTHOR is disputed. John 7:53-8:11 is absent from
 * the earliest manuscripts, and an app that hands someone a passage to sit with
 * should say so rather than let them find out elsewhere. Same principle as
 * authors.attributionNote — admitting uncertainty is what earns trust here.
 */
export type PericopeRange =
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, string];

export const CURATED_PERICOPES: Readonly<Record<string, readonly PericopeRange[]>> = {
  // ---- The stage anchors ---------------------------------------------------
  colossians: [
    [3, 1, 3, 4],
    // Household code. Begins at 3:18 and runs past the chapter break to 4:1,
    // where "Masters, give to your servants that which is just and equal" is the
    // half that makes the passage mutual rather than one-directional.
    [3, 18, 4, 1],
    // The put off / put on passage. ARCHITECTURE.md §1 anchors all seven stages
    // here, so this boundary is load-bearing rather than editorial.
    [3, 5, 3, 14],
    [3, 15, 3, 17],
  ],
  ephesians: [
    [1, 3, 1, 14],
    [2, 1, 2, 7],
    // Grace through faith, not of works. One of the most-quoted units in the NT.
    [2, 8, 2, 10],
    [2, 11, 2, 22],
    [4, 1, 4, 6],
    [4, 7, 4, 16],
    [4, 17, 4, 21],
    // The other put off / put on passage.
    [4, 22, 4, 24],
    [4, 25, 4, 32],
    [5, 1, 5, 20],
    // Household code, and it BEGINS AT 5:21 — "subjecting yourselves to one
    // another in the fear of Christ" is the hinge the rest hangs off. Starting a
    // verse later, at 5:22, is the single most consequential mis-boundary in
    // this table's territory: it turns a mutual instruction into an unqualified
    // one. The previous entry was trimmed to 5:20 to make room for it.
    [5, 21, 6, 9],
    [6, 10, 6, 20],
  ],

  // ---- The brand chapter ---------------------------------------------------
  matthew: [
    [5, 1, 5, 12],
    [5, 13, 5, 16],
    [5, 17, 5, 20],
    [5, 21, 5, 22],
    // "Leave your gift there before the altar, and go your way." The passage
    // Abigail uses when the right answer is to close the app.
    [5, 23, 5, 24],
    [5, 27, 5, 30], // whoever looks at a woman to lust after her
    [6, 5, 6, 15],
    [6, 25, 6, 34],
    // Matthew 7 is the brand chapter: the beam in your own eye, then ask/seek/knock.
    [7, 1, 7, 6],
    [7, 7, 7, 12],
    [7, 13, 7, 14],
    [7, 15, 7, 23],
    [7, 24, 7, 29],
    // Sending of the twelve: the need for labourers, then the naming of them.
    // 10:5 begins the instructions, which is a separate unit.
    [9, 35, 10, 4],
    // The mustard seed as growth: the least of seeds becomes a tree.
    [13, 31, 13, 32],
    // The mustard seed as welcome: what you already have is enough.
    [17, 14, 17, 21],
    [18, 21, 18, 35],
    [20, 1, 20, 16], // the workers in the vineyard — the envy parable
    [22, 34, 22, 40],
    [25, 14, 25, 30], // the talents
  ],

  // ---- Frequently handed to someone sitting with something -----------------
  psalms: [
    // Psalms are segmented whole-psalm by rule, not by table — see segment.ts.
  ],
  romans: [
    [5, 1, 5, 5],
    [13, 11, 13, 14], // put on the Lord Jesus, make no provision for the flesh

    [8, 1, 8, 11],
    [8, 18, 8, 30],
    [8, 31, 8, 39],
    [12, 1, 12, 2],
    [12, 9, 12, 21],
  ],
  "1-corinthians": [
    [6, 12, 6, 14], // all things are lawful, but not all are helpful
    [9, 24, 9, 27], // I beat my body and bring it into submission
    [10, 12, 10, 13],
    // The love passage WITH its frame on both sides. 12:31 announces "a most
    // excellent way" and 14:1 answers it with "Follow after love" — read as
    // chapter 13 alone, the passage loses the argument it was answering and
    // becomes a wedding reading.
    //
    // This deliberately replaces a standalone 13:1-13 entry. The cost is that
    // "1 Corinthians 13" is no longer a stored passage in its own right and
    // resolves as an ad-hoc range; the gain is that retrieval returns the unit
    // Paul actually wrote.
    [12, 31, 14, 1],
    [15, 50, 15, 58],
  ],
  "2-corinthians": [
    [4, 7, 4, 18],
    [5, 16, 5, 21],
    // Unequally yoked. The paragraph runs past the chapter break: 7:1 is the
    // "having therefore these promises" that the whole warning was building to.
    [6, 14, 7, 1],
    [9, 6, 9, 11], // God loves a cheerful giver
    [12, 7, 12, 10],
  ],
  galatians: [
    [5, 16, 5, 26],
    [6, 1, 6, 5],
    [6, 7, 6, 10],
  ],
  philippians: [
    [1, 3, 1, 11],
    [3, 17, 3, 21], // whose god is their belly

    [2, 1, 2, 11],
    [3, 7, 3, 14],
    [4, 4, 4, 9],
    [4, 10, 4, 13],
  ],
  james: [
    [1, 2, 1, 8],
    [1, 19, 1, 27],
    [2, 14, 2, 26],
    [3, 1, 3, 12],
    // Envy and quarrels: "where jealousy and selfish ambition are, there is
    // confusion" straight through to "you ask with wrong motives". Directly
    // serves the envy stage, and the chapter break cuts it in two.
    [3, 13, 4, 3],
    [4, 4, 4, 10],
    [5, 13, 5, 20],
  ],
  hebrews: [
    [4, 12, 4, 16],
    [13, 5, 13, 6], // be free from the love of money

    [11, 1, 11, 3],
    [12, 1, 12, 3],
    [12, 4, 12, 11],
  ],
  "1-john": [
    [1, 5, 1, 10],
    [3, 16, 3, 20],
    [4, 7, 4, 12],
    [4, 16, 4, 21],
  ],
  john: [
    [1, 1, 1, 5],
    // The woman caught in adultery. Included BECAUSE it is pastorally central,
    // and noted because it is textually disputed — see the note, which travels
    // onto the passage and out through the API.
    [
      7,
      53,
      8,
      11,
      "This passage is not found in the earliest surviving manuscripts of John, " +
        "and its placement varies in those that do contain it. Most scholars " +
        "regard it as a later addition to the text. It has been read and taught " +
        "as part of the church's scripture for centuries; both of those things " +
        "are true at once.",
    ],
    [3, 1, 3, 15],
    [3, 16, 3, 21],
    [10, 7, 10, 18],
    [14, 1, 14, 7],
    [15, 1, 15, 17],
    [21, 15, 21, 19],
  ],
  luke: [
    [10, 25, 10, 37],
    [12, 13, 12, 21], // the rich fool

    // "Beware of the scribes, who devour widows' houses" — and then, immediately,
    // a widow giving everything she had. The juxtaposition IS the passage, and
    // the chapter break sits right between the two halves.
    [20, 45, 21, 4],
    [15, 1, 15, 7],
    [15, 11, 15, 32],
    [18, 9, 18, 14],
  ],
  isaiah: [
    [40, 27, 40, 31],
    // The suffering servant. NON-NEGOTIABLE: the chapter break falls in the
    // middle of the song. It opens at 52:13 with "Behold, my servant will deal
    // wisely", and a passage starting at 53:1 has lost its own first movement.
    [52, 13, 53, 12],
    [43, 1, 43, 7],
    [55, 6, 55, 13],
  ],
  jeremiah: [[29, 10, 29, 14]],
  "1-timothy": [[6, 6, 6, 10]], // godliness with contentment is great gain
  "2-thessalonians": [[3, 6, 3, 13]],
  "1-thessalonians": [
    [4, 3, 4, 8],
    [5, 16, 5, 18],
  ],
  exodus: [[20, 12, 20, 17]], // you shall not covet
  job: [[31, 1, 31, 4]], // a covenant with my eyes
  ecclesiastes: [[9, 10, 9, 12]],
  titus: [[2, 11, 2, 14]],
  mark: [
    // Take up your cross. 9:1 closes it; 9:2 ("After six days") opens the
    // transfiguration.
    [8, 34, 9, 1],
  ],
  acts: [
    [20, 32, 20, 35], // more blessed to give than to receive
    // The stoning of Stephen, closing with "Saul was consenting to his death" —
    // the sentence that introduces Paul to the narrative.
    [7, 54, 8, 1],
  ],
  "2-samuel": [
    // David, Bathsheba, Uriah, and Nathan. Long, and deliberately one unit: this
    // is the context behind Psalm 51 and behind David's `circumstances`, and it
    // does not work in halves — the confrontation is the point of the account.
    [11, 1, 12, 25],
  ],
  malachi: [
    // The closing oracle, and the last words of the Old Testament. The chapter
    // break here is an artefact; 3:16 through 4:6 is one movement.
    [3, 16, 4, 6],
  ],
  lamentations: [[3, 19, 3, 26]],
  proverbs: [
    [3, 5, 3, 8],
    [4, 23, 4, 27],
    [6, 6, 6, 11], // go to the ant, you sluggard
    [15, 1, 15, 2], // a soft answer turns away wrath
    [25, 16, 25, 17], // have you found honey? eat as much as is sufficient
  ],
  genesis: [
    // The creation account, ending where it actually ends. The seventh day is
    // 2:1-3; 2:4 opens the toledot ("This is the history of the generations"),
    // which is the start of the next thing.
    [1, 1, 2, 3],
    [3, 1, 3, 13],
    [50, 15, 50, 21],
  ],
  micah: [[6, 6, 6, 8]],
  jonah: [[4, 1, 4, 11]],
  habakkuk: [[3, 17, 3, 19]],
};
