// The seven stages.
//
// ARCHITECTURE.md §1 anchors all of them in Colossians 3:5-14 and Ephesians
// 4:22-24 — the put off / put on passages — rather than in the medieval vice
// list. The difference is not decorative: a vice list names only the thing being
// removed, and says nothing about what takes its place. "Put off… put on" is a
// movement, and every stage below is written as one.
//
// OPENING QUESTIONS ARE THE FIRST THING A PERSON HEARS when a stage opens, and
// they are written to that standard. Three rules held throughout:
//
//   THEY MUST NOT ACCUSE. "What made you angry this week" is a question.
//   "Why are you so proud" is a verdict wearing a question mark, and nobody
//   answers it honestly — they defend themselves, which is the opposite of the
//   thing the stage is for.
//
//   THEY MUST SOUND LIKE A PERSON. Not an intake form, not a devotional prompt,
//   not therapy-speak. Something a thoughtful friend would actually say out loud.
//
//   THEY MUST BE ANSWERABLE. A question that can only be answered with "yes I am
//   bad at this" is not a way in. Each of these can be answered concretely, by
//   describing something that happened.

import type { StageSlug } from "@discern/shared";

export interface StageSeed {
  slug: StageSlug;
  order: number;
  from: string;
  to: string;
  description: string;
  /** Stage-specific anchors. The two shared ones are added by the seed script. */
  anchorPassages: string[];
  openingQuestions: string[];
}

/**
 * Anchored to EVERY stage, because they are the frame the whole path sits in.
 * Added to each stage by the seed script rather than repeated seven times here.
 */
export const SHARED_ANCHORS = ["Colossians 3:5-14", "Ephesians 4:22-24"];

export const STAGE_SEEDS: readonly StageSeed[] = [
  {
    slug: "pride-humility",
    order: 1,
    from: "pride",
    to: "humility",
    description:
      "Pride is not thinking well of yourself; it is needing to be right more than you need to see clearly. The movement is toward being teachable — which is why Matthew 7 puts the beam in your own eye before anything else.",
    anchorPassages: [
      "Matthew 7:1-6",
      "Luke 18:9-14",
      "Philippians 2:1-11",
      "James 4:4-10",
      "Micah 6:6-8",
      "Proverbs 3:5-8",
      "Romans 12:1-2",
    ],
    openingQuestions: [
      "When did you last change your mind about something that mattered?",
      "Who is allowed to tell you when you're wrong?",
      "What's something you're good at that you'd rather not have to keep proving?",
      "Is there an argument you won that you're still not sure about?",
    ],
  },
  {
    slug: "greed-generosity",
    order: 2,
    from: "greed",
    to: "generosity",
    description:
      "Greed is rarely about wanting more; it is usually about wanting to be safe. The movement is toward holding things loosely enough to give them away — which requires believing you will still be all right afterwards.",
    anchorPassages: [
      "Luke 20:45-21:4",
      "Matthew 6:25-34",
      "Luke 12:13-21",
      "1 Timothy 6:6-10",
      "2 Corinthians 9:6-11",
      "Hebrews 13:5-6",
      "Acts 20:32-35",
    ],
    openingQuestions: [
      "What would you least want to be without?",
      "What are you saving for, and what would count as enough?",
      "When did you last give something away and actually feel it?",
      "What do you spend money on when you're worried?",
    ],
  },
  {
    slug: "lust-pure-love",
    order: 3,
    from: "lust",
    to: "pure love",
    description:
      "Lust treats a person as a means. The movement is not toward wanting less, but toward wanting someone's good more than you want them — which is a harder and more interesting thing than restraint.",
    anchorPassages: [
      "Matthew 5:27-30",
      "1 Corinthians 6:18-20",
      "1 Thessalonians 4:3-8",
      "2 Corinthians 6:14-7:1",
      "1 Corinthians 12:31-14:1",
      "Job 31:1-4",
      "Galatians 5:16-26",
      "Psalms 51:1-19",
    ],
    openingQuestions: [
      "Who do you want to be for the person you love?",
      "What are you actually looking for when you go looking?",
      "When did wanting something last leave you emptier than before?",
      "What would change if nobody ever found out either way?",
    ],
  },
  {
    slug: "envy-gratitude",
    order: 4,
    from: "envy",
    to: "gratitude",
    description:
      "Envy is grief at someone else's good, and it is exhausting because it never ends — there is always another life to measure against. The movement is toward being able to see what you have without first checking it against somebody else's.",
    anchorPassages: [
      "James 3:13-4:3",
      "Psalms 73:1-28",
      "Galatians 5:16-26",
      "Philippians 4:10-13",
      "Colossians 3:15-17",
      "1 Thessalonians 5:16-18",
      "Matthew 20:1-16",
      "Exodus 20:12-17",
    ],
    openingQuestions: [
      "Whose life have you been checking on lately?",
      "When someone you know did well recently, how did that sit?",
      "What did you have this week that you didn't notice at the time?",
      "What would you want if you'd never seen anyone else have it?",
    ],
  },
  {
    slug: "gluttony-temperance",
    order: 5,
    from: "gluttony",
    to: "temperance",
    description:
      "Gluttony is not enjoying things too much; it is reaching for them to avoid something else. The movement is toward enjoying them more, and more slowly, which is what temperance has always actually meant.",
    anchorPassages: [
      "1 Corinthians 10:12-13",
      "Galatians 5:16-26",
      "Titus 2:11-14",
      "Romans 13:11-14",
      "1 Corinthians 6:12-14",
      "Proverbs 25:16-17",
      "Philippians 3:17-21",
      "1 Corinthians 9:24-27",
    ],
    openingQuestions: [
      "What do you reach for when the day has been long?",
      "What's something you enjoy that you'd like to enjoy more slowly?",
      "When did you last stop before you had to?",
      "What are you usually avoiding in the half hour before you reach for it?",
    ],
  },
  {
    slug: "wrath-patience",
    order: 6,
    from: "wrath",
    to: "patience",
    description:
      "Anger is usually right about something and wrong about what to do next. The movement is not toward feeling less, but toward being able to hold it long enough to act well — and sometimes toward going and fixing the thing directly (Matthew 5:23-24).",
    anchorPassages: [
      "Matthew 5:21-22",
      "Matthew 5:23-24",
      "Matthew 18:21-35",
      "Ephesians 4:25-32",
      "James 1:19-27",
      "Romans 12:9-21",
      "Proverbs 15:1-2",
      "Colossians 3:15-17",
    ],
    openingQuestions: [
      "What made you angry this week?",
      "Who are you still arguing with in your head?",
      "What would you say to them if you weren't angry when you said it?",
      "Is there something you're angry about that you're right about?",
    ],
  },
  {
    slug: "sloth-diligence",
    order: 7,
    from: "sloth",
    to: "diligence",
    description:
      "Sloth is not laziness so much as not caring enough to begin — the quiet decision that it does not matter whether you do this. The movement is toward doing the next small thing, which is almost always available even when the whole thing is not.",
    anchorPassages: [
      "Colossians 3:18-4:1",
      "Hebrews 12:1-3",
      "Galatians 6:7-10",
      "Proverbs 6:6-11",
      "Matthew 25:14-30",
      "2 Thessalonians 3:6-13",
      "Ecclesiastes 9:10-12",
      "Romans 12:9-21",
    ],
    openingQuestions: [
      "What have you been meaning to do?",
      "What's the thing you keep deciding to start on Monday?",
      "What's the smallest part of it you could do today?",
      "What would be different in a year if you did start?",
    ],
  },
];
