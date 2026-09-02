// Candidate anchor passages for the seven stages (ARCHITECTURE.md §1, §6).
//
// This file exists BEFORE Phase 5 because it answers a Phase 2 question: does
// the corpus actually contain, as RETRIEVABLE UNITS, the passages each stage
// needs? A stage whose anchors only exist as ad-hoc ranges cannot be served —
// retrieval returns stored passages, and a passage that is not stored cannot be
// embedded, offered as a carrying, or handed to anyone.
//
// The put off / put on passages (Colossians 3:5-14, Ephesians 4:22-24) anchor
// ALL SEVEN stages and are deliberately not repeated in each list below.
//
// Phase 5 seeds `stages` from this; the audit script reads it now.

export interface StageAnchors {
  slug: string;
  from: string;
  to: string;
  /** References that should exist as stored passages. */
  anchors: string[];
}

export const STAGE_ANCHORS: readonly StageAnchors[] = [
  {
    slug: "pride-humility",
    from: "pride",
    to: "humility",
    anchors: [
      "Matthew 7:1-6", // the beam in your own eye — the brand chapter
      "Luke 18:9-14", // the Pharisee and the tax collector
      "Philippians 2:1-11", // he emptied himself
      "James 4:4-10", // God resists the proud
      "Micah 6:6-8", // walk humbly
      "Proverbs 3:5-8", // lean not on your own understanding
      "1 Peter 5:5-7",
      "Romans 12:1-2",
    ],
  },
  {
    slug: "greed-generosity",
    from: "greed",
    to: "generosity",
    anchors: [
      "Luke 20:45-21:4", // the widow's two coins, against the scribes
      "Matthew 6:25-34", // do not be anxious
      "Luke 12:13-21", // the rich fool
      "1 Timothy 6:6-10",
      "2 Corinthians 9:6-11",
      "Hebrews 13:5-6",
      "Acts 20:32-35",
      "Proverbs 11:24-25",
    ],
  },
  {
    slug: "lust-pure-love",
    from: "lust",
    to: "pure love",
    anchors: [
      "Matthew 5:27-30",
      "1 Corinthians 6:18-20",
      "1 Thessalonians 4:3-8",
      "2 Corinthians 6:14-7:1", // unequally yoked
      "1 Corinthians 12:31-14:1", // what love actually is
      "Job 31:1-4",
      "Galatians 5:16-26",
      "Psalms 51:1-19",
    ],
  },
  {
    slug: "envy-gratitude",
    from: "envy",
    to: "gratitude",
    anchors: [
      "James 3:13-4:3", // where jealousy is, there is confusion
      "Psalms 73:1-28", // the psalm about envying the prosperous
      "Galatians 5:16-26",
      "Philippians 4:10-13", // I have learned to be content
      "Colossians 3:15-17", // and be thankful
      "1 Thessalonians 5:16-18",
      "Matthew 20:1-16", // the workers in the vineyard
      "Exodus 20:12-17",
    ],
  },
  {
    slug: "gluttony-temperance",
    from: "gluttony",
    to: "temperance",
    anchors: [
      "1 Corinthians 10:12-13", // no temptation but such as is common
      "Galatians 5:16-26", // self-control as fruit
      "Titus 2:11-14",
      "Romans 13:11-14",
      "1 Corinthians 6:12-14",
      "Proverbs 25:16-17",
      "Philippians 3:17-21",
      "1 Corinthians 9:24-27",
    ],
  },
  {
    slug: "wrath-patience",
    from: "wrath",
    to: "patience",
    anchors: [
      "Matthew 5:21-22",
      "Matthew 5:23-24", // leave your gift and go — close the app
      "Matthew 18:21-35", // the unforgiving servant
      "Ephesians 4:25-32", // do not let the sun go down
      "James 1:19-27", // slow to anger
      "Romans 12:9-21", // do not repay evil for evil
      "Proverbs 15:1-2",
      "Colossians 3:15-17",
    ],
  },
  {
    slug: "sloth-diligence",
    from: "sloth",
    to: "diligence",
    anchors: [
      "Colossians 3:18-4:1", // whatever you do, work heartily
      "Hebrews 12:1-3", // run with endurance
      "Galatians 6:7-10", // do not grow weary in doing good
      "Proverbs 6:6-11", // go to the ant
      "Matthew 25:14-30", // the talents
      "2 Thessalonians 3:6-13",
      "Ecclesiastes 9:10-12",
      "Romans 12:9-21",
    ],
  },
];
