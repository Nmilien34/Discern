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
  /**
   * magnitude = 1. They finished a cultivation read.
   *
   * THE SMALLEST AWARD IN THE SYSTEM, and it has to be. Humility is nine reads
   * and 4,147 words; at 2 points each the whole virtue is worth 18, which is
   * LESS THAN ONE action_taken at 25. That ordering is the product's claim
   * stated in numbers: reading about it is not the practice, and an app that
   * paid more for consumption than for going and apologising would be teaching
   * the opposite of what its reads say.
   *
   * Ten reads < one action was the requirement. 10 x 2 = 20 < 25. ✓
   *
   * COUNTED ONCE PER READ, EVER — not once per day. Re-reading is genuinely
   * valuable and the ledger already pays for returning through `revisit`;
   * paying `read_completed` again for the same read would make the number mean
   * "times opened" rather than "reads completed". Enforced on `sourceId` at
   * write time, in journey/reads.service.ts.
   */
  read_completed: {
    perUnit: 2,
    cap: 2,
    rationale:
      "The smallest award there is. Nine reads of a finished virtue come to 18 " +
      "points, below a single action_taken at 25, because reading about " +
      "humility is not practising it and the ledger should not pretend " +
      "otherwise.",
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
/**
 * THE STANDING RULE, AND IT IS NOT NEGOTIABLE PER EVENT:
 *
 *   ANY EVENT GATED BY A MODEL'S JUDGEMENT IS CAPPED PER DAY, ON PRINCIPLE,
 *   WHETHER OR NOT ANYONE HAS DEMONSTRATED IT CAN BE FORCED.
 *
 * `premise_reframed` is the reason it is written down. It fires when the
 * premise pass returns "wrong" or "incomplete", which is an LLM's opinion —
 * and whether a crafted message can push that opinion is a question nobody has
 * answered. THE RULE MEANS WE DO NOT HAVE TO ANSWER IT. Non-deterministic plus
 * uncapped is a hole that needs no adversary: it was reachable at 2,250 points
 * a day by a heavy user with no bad intent at all, which put Shelter inside a
 * day of conversation.
 *
 * The damage was never the number. It was that two turns of chat outranked
 * going to a person you were wrong about and saying so out loud, when these
 * weights exist to express exactly the opposite ordering.
 *
 * Every future event should be read against this: if a model decides whether it
 * fires, it gets a line here the same day it gets a weight.
 */
export const SEED_DAILY_CAPS: Partial<Record<SeedEventType, number>> = {
  dwell_time: 20,
  revisit: 16,
  conversation_depth: 12,
  /**
   * ONE PAID REFRAMING A DAY. It is supposed to be rare, and it was firing on
   * roughly 70% of turns — 355 of 508 in production.
   *
   * The cap does not make the trigger right; it makes the trigger's wrongness
   * bounded. A verdict of "incomplete" describes most questions anybody asks,
   * so 70% is not a reframing rate, it is a verdict doing a different job. That
   * is a separate change and it is not made here.
   */
  premise_reframed: 15,
  // NOT read_completed. It is already bounded absolutely — each read pays once
  // and there are nine per virtue — so a daily ceiling would only punish
  // somebody who sat down and read the whole path in an afternoon, which is a
  // thing this product should be glad about rather than throttle.
};

/* ── THE SECOND AXIS ─────────────────────────────────────────────────────────
 *
 * TWO AXES, NEVER ONE.
 *
 *   stage  how far it has come. Only ever goes UP, and vigor cannot touch it.
 *   vigor  how recently it has been tended.
 *
 * Vigor softens the foliage's colour and nothing else. SIZE NEVER MOVES WITH
 * IT: the stage axis is the one that grows, it only ever goes up, and so
 * nothing a person has done can be taken away by being away.
 *
 * FLOORED AT 0.42 — quiet and dormant, never grey, never bare, never dropping
 * leaves. A tree that looks like it is dying because somebody missed a week is
 * a guilt mechanic, and guilt is not what brings anyone back to this. The floor
 * is in the CONTRACT as well as here (`seedResponseSchema.vigor` is
 * `.min(0.42)`), so a response that expressed a dying tree would fail
 * validation before it ever reached a screen.
 *
 * IT IS NOT A STREAK, and the difference is worth being exact about. A streak
 * counts consecutive days and is LOST by missing one. Vigor is a function of a
 * single number — how long since the last real event — so there is nothing to
 * break, nothing accumulates, and one return restores it completely. Come back
 * after eight months and it is full again the same day, with nothing to
 * re-earn.
 *
 * AND IT CANNOT BE FARMED BY OPENING THE APP, because there is no event type
 * for opening the app. Every input to this is something that actually happened.
 */

/** Quiet and dormant. The lowest the tree can ever look. */
export const VIGOR_FLOOR = 0.42;

/** "Read something, did something, this week." Full through day seven. */
export const VIGOR_FULL_DAYS = 7;

/** "Away a long time." The floor is reached here and never goes below. */
export const VIGOR_DORMANT_DAYS = 32;

/**
 * How recently tended, as 0.42-1.
 *
 * Full for a week, then straight down to the floor across the following
 * twenty-five days. The midpoint lands near 0.68 at three weeks, which is the
 * "easing" state the canvas draws: a couple of quiet weeks, softer, same size,
 * same seven branches.
 *
 * NULL MEANS NO EVENTS YET, AND THAT IS FULL VIGOR, NOT DORMANT. Someone who
 * opened the app an hour ago has not neglected anything, and greeting a new
 * person with a faded tree would be the first thing the product said to them.
 */
export function vigorFor(daysSinceLastEvent: number | null): number {
  if (daysSinceLastEvent === null) return 1;
  if (daysSinceLastEvent <= VIGOR_FULL_DAYS) return 1;
  if (daysSinceLastEvent >= VIGOR_DORMANT_DAYS) return VIGOR_FLOOR;

  const spanDays = VIGOR_DORMANT_DAYS - VIGOR_FULL_DAYS;
  const travelled = (daysSinceLastEvent - VIGOR_FULL_DAYS) / spanDays;
  const value = 1 - travelled * (1 - VIGOR_FLOOR);

  // Two decimal places: this drives a colour mix, and an unrounded float would
  // make the canvas cache key in the client miss on every render.
  return Math.round(value * 100) / 100;
}

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
 *
 * ROOT WAS LOWERED 25 -> 10 on 2026-09-06 so that a reads-only trial week
 * actually moves the tree. Measured, seven days, one read a day:
 *
 *   reads only                    14 pts   Root on day 5     (was: never left Seed)
 *   reads + 5 min on one carrying 87 pts   Root d1, SHOOT d6
 *   reads + two carryings        196 pts   Root d1, Sapling d7
 *
 * THE SECOND AND THIRD LINES ARE THE REAL PROBLEM AND THIS CHANGE DOES NOT
 * TOUCH THEM. They overshoot because `revisit` pays 8 and fires on EVERY dwell
 * PATCH including the first — so "coming back" is worth more than three reads
 * before anyone has come back to anything. A carrying user reached Shoot inside
 * the trial at the old threshold too; Root moving only changes which day Root
 * happens. Fixing that means changing what a revisit is worth, or not paying
 * one on first contact, and neither was in scope here.
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
    // 25 -> 10 on 2026-09-06, and the reason is the trial week.
    //
    // read_completed pays 2. Someone who does the thing the product is FOR —
    // reads one cultivation read a day for the seven days of the trial and
    // touches nothing else — finished the week on 14 points and watched a tree
    // that had not moved once. At 10 they cross into Root on day five, which is
    // inside the week that decides whether they stay.
    //
    // NO EVENT WEIGHT MOVED. This is a threshold change only, so nothing about
    // what an action or a revisit is WORTH has been restated — see the note
    // under GROWTH_STAGE_DEFINITIONS about what still overshoots.
    threshold: 10,
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
