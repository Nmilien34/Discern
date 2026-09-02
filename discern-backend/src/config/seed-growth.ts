// THE GROWTH CURVE. THE ONLY FILE THAT DECIDES WHAT THE SEED MEANS.
//
// Everything about the seed is derived from the append-only ledger at read time
// using the numbers below. Nothing here is written to a document, which is the
// point: the curve can be retuned — after watching real practice, or because a
// weight turns out to be wrong — WITHOUT TOUCHING ANYONE'S HISTORY. A stored
// score would freeze today's opinion into every user's past.
//
// WHAT THIS IS NOT, and the absences are the positioning:
//
//   NO DECAY.            Nothing shrinks. A person who steps away for eight
//                        months and comes back finds their seed where they left
//                        it, because the alternative is an app that punishes you
//                        for the exact season you most needed to be away.
//   NO ABSENCE PENALTY.  Same rule, stated the other way round so nobody
//                        reintroduces it as "inactivity adjustment".
//   NO DAILY-OPEN CREDIT. Opening the app is not practice. There is no event
//                        type for it, so there is nothing to award.
//   NOT A STREAK.        Consecutive days are never counted, anywhere.
//
// ARCHITECTURE.md §1: the seed measures practice, never holiness. It is private,
// never comparative, and it never shrinks from absence.

import type { GrowthStage, SeedEventType } from "@discern/shared";

/**
 * How a raw event magnitude becomes points.
 *
 * `perUnit` multiplies the event's stored `weight`, which is a MAGNITUDE (dwell
 * seconds, conversation turns) rather than a score. `cap` bounds a single event
 * so one enormous session cannot outweigh months of returning.
 *
 * THE ORDERING IS THE PRODUCT. Dwelling and returning are worth more than
 * volume: someone who sits with one passage four times must end up further along
 * than someone who collects twelve. Collecting is not even an event type, so it
 * earns nothing at all — that is deliberate, not an omission.
 */
export interface SeedEventWeight {
  perUnit: number;
  cap: number;
  /** Why this number, so a future retune is a decision rather than a guess. */
  rationale: string;
}

export const SEED_EVENT_WEIGHTS: Record<SeedEventType, SeedEventWeight> = {
  /** magnitude = seconds spent with a carrying. */
  dwell_time: {
    perUnit: 1 / 120,
    cap: 10,
    rationale:
      "One point per two minutes, capped at 10 (20 minutes). Time matters, but " +
      "a three-hour session is not fifteen times more formative than twenty " +
      "minutes, and paying it as though it were rewards having a free afternoon.",
  },
  /** magnitude = 1 per return to something already carried. */
  revisit: {
    perUnit: 8,
    cap: 8,
    rationale:
      "The single most important signal in the app. Returning to the same " +
      "passage is the behaviour the whole product exists to produce, and it is " +
      "priced well above anything that resembles collecting.",
  },
  /** magnitude = number of turns in the conversation. */
  conversation_depth: {
    perUnit: 1,
    cap: 6,
    rationale:
      "Depth, not count. Capped low so a long conversation cannot outrun the " +
      "practice of returning, and so nobody is nudged toward padding a chat.",
  },
  /** magnitude = 1. Abigail corrected an assumption and the person took it. */
  premise_reframed: {
    perUnit: 15,
    cap: 15,
    rationale:
      "The moment the product is FOR. Rare by nature, so it is worth roughly " +
      "two revisits when it happens.",
  },
  /** magnitude = 1. They went and did the human thing. */
  action_taken: {
    perUnit: 25,
    cap: 25,
    rationale:
      "The highest single award in the system, and it is earned OUTSIDE the " +
      "app — going to apologise, making the call (Matthew 5:23-24). An app " +
      "about practice should pay most for the practice that leaves it.",
  },
  /** magnitude = 1. Moved into or through a stage. */
  stage_movement: {
    perUnit: 20,
    cap: 20,
    rationale:
      "Structural progress. High, but below action_taken: naming where you are " +
      "matters less than doing something about it.",
  },
};

/**
 * PER-DAY CEILINGS ON PASSIVE EVENT TYPES.
 *
 * Without these, dwell_time and revisit are FARMABLE, and not subtly: the client
 * supplies dwellSeconds, every PATCH earns up to the per-event cap AND
 * increments revisitCount, so a loop of a hundred requests is worth about 1,800
 * points — Shelter in an afternoon.
 *
 * Enforced at READ TIME in computeSeed, not at write time. The ledger stays a
 * faithful record of what happened; the ceiling is an opinion about what it is
 * worth, and opinions belong in this file where they can be changed without
 * touching history.
 *
 * THIS IS NOT A STREAK. Nothing is required daily, nothing is lost by missing a
 * day, and no consecutive-day count exists anywhere. A ceiling limits what one
 * day can be worth; it never asks for the next one.
 *
 * Active types are deliberately uncapped: premise_reframed, action_taken and
 * stage_movement cannot be produced by clicking, and a person who genuinely went
 * and repaired two relationships in one day should be credited for both.
 */
export const SEED_DAILY_CAPS: Partial<Record<SeedEventType, number>> = {
  dwell_time: 20,
  revisit: 16,
  conversation_depth: 12,
};

/**
 * A revisit only counts once per carrying per day.
 *
 * "Returning" means coming back later, not tapping twice in a session. Counting
 * every dwell PATCH as a return makes the word mean nothing.
 */
export const REVISITS_PER_CARRYING_PER_DAY = 1;

export interface GrowthStageDefinition {
  stage: GrowthStage;
  /** Cumulative points at which this stage begins. */
  threshold: number;
  label: string;
  description: string;
}

/**
 * The arc, from Matthew 13:31-32.
 *
 * It ends in SHELTER — "the birds of the air come and lodge in the branches
 * thereof" — not in a bigger seed. A growth metric whose endpoint is "you are
 * now very grown" points at the user; this one points past them, which is the
 * only version of this idea worth shipping in an app about formation.
 *
 * Matthew 17:20 is the welcome at the other end: what you already have is
 * enough. Nobody starts at zero-and-lacking. They start as a seed, which is the
 * thing the parable calls sufficient.
 *
 * THRESHOLDS. Branching and Shelter were raised (350->500, 600->1000) because an
 * engaged week is roughly 65-70 points, which reached Shelter in about nine
 * weeks. Nine weeks is too fast for the metaphor: a tree that birds lodge in is
 * not two months old, and a metric that says otherwise quietly tells people
 * formation is quicker than it is. Shelter is now roughly a year of real
 * practice.
 */
export const GROWTH_STAGE_DEFINITIONS: readonly GrowthStageDefinition[] = [
  {
    stage: "seed",
    threshold: 0,
    label: "Seed",
    description:
      "What you have is already enough to begin with. Nothing here is missing yet.",
  },
  {
    stage: "root",
    threshold: 25,
    label: "Root",
    description:
      "The part nobody sees. Roots go down before anything comes up, and this is the stretch where it feels like nothing is happening.",
  },
  {
    stage: "shoot",
    threshold: 75,
    label: "Shoot",
    description:
      "The first thing visible above ground. Small, and easy to damage, and genuinely there.",
  },
  {
    stage: "sapling",
    threshold: 175,
    label: "Sapling",
    description:
      "Standing on its own now. Still bends in weather, but it no longer needs holding up.",
  },
  {
    stage: "branching",
    threshold: 500,
    label: "Branching",
    description:
      "Growing outward rather than only upward. What you have been given is starting to reach past you.",
  },
  {
    stage: "shelter",
    threshold: 1000,
    label: "Shelter",
    description:
      "Where the birds of the air come and lodge in the branches. The end of the parable is not a bigger seed — it is a tree that other people can rest in.",
  },
];

/** Points for one event, given its stored magnitude. */
export function pointsForEvent(type: SeedEventType, magnitude: number): number {
  const weight = SEED_EVENT_WEIGHTS[type];
  if (!weight) return 0;

  const raw = Math.max(0, magnitude) * weight.perUnit;
  return Math.min(raw, weight.cap);
}

export function growthStageFor(points: number): GrowthStageDefinition {
  let current = GROWTH_STAGE_DEFINITIONS[0] as GrowthStageDefinition;

  for (const definition of GROWTH_STAGE_DEFINITIONS) {
    if (points >= definition.threshold) current = definition;
  }

  return current;
}

export function nextGrowthStageAfter(
  stage: GrowthStage,
): GrowthStageDefinition | null {
  const index = GROWTH_STAGE_DEFINITIONS.findIndex((d) => d.stage === stage);
  // The arc ends. It does not loop, and there is no prestige tier — that would
  // turn formation into a game with a scoreboard.
  return GROWTH_STAGE_DEFINITIONS[index + 1] ?? null;
}
