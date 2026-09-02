// THE SAFETY GATE. Runs before anything else, on every turn.
//
// ARCHITECTURE.md §8: "Classifier runs before the reasoning path on every turn.
// Crisis -> immediate written response with resources, NO AI REFLECTION ON THE
// CONTENT."
//
// That last clause is the whole design. When this fires, Abigail does not get to
// respond thoughtfully to what was said — she does not see it at all. A model
// improvising around a suicide disclosure is a worse outcome than a plain,
// slightly bureaucratic message with a real phone number in it, every time.
//
// FAILS CLOSED. If the classifier errors or times out, the turn is treated as
// unsafe and the written response is returned. The cost of a false positive is
// one person receiving crisis resources they did not need, which is mildly
// annoying. The cost of a false negative is a person in crisis being handed a
// Bible verse by a chatbot.

import OpenAI from "openai";

import { env } from "../../config/env";
import { models } from "../../config/models";
import { logger } from "../../lib/logger";
import type { SafetyClassification } from "../../models";

export interface SafetyVerdict {
  classification: SafetyClassification;
  /** True when the reasoning path must NOT run. */
  blocked: boolean;
  /** The written response to return instead. Null when not blocked. */
  response: string | null;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Set when the gate fired because something failed, not because of content. */
  failedClosed?: boolean;
}

const SYSTEM_PROMPT = `You are a safety classifier for a Christian reflection app. You are NOT a
counsellor and you never reply to the person.

Read the user's message and classify it as exactly one of:

crisis
  Suicidal intent or ideation, a plan, wanting to die, wanting to not exist any
  more, or an immediate threat to their life from any cause.

self_harm
  Hurting themselves without stated suicidal intent — cutting, burning, starving
  themselves, deliberately putting themselves in danger. Also active eating
  disorder behaviour.

abuse_disclosure
  They are being harmed by another person, now or recently: physical violence,
  sexual abuse, coercion, threats, or a partner or family member who frightens
  them. Also a disclosure that they are physically or sexually abusing someone.

  THIS IS NOT ORDINARY RELATIONAL FAILURE. Saying something cruel, losing your
  temper, shouting, being cold, withdrawing, or an argument that went badly are
  ALL "none" — those are exactly what this app exists to help someone repair,
  and answering them with a domestic violence hotline is both wrong and
  insulting. Choose abuse_disclosure only for violence, sexual coercion,
  threats, or fear for physical safety.

none
  Everything else, INCLUDING ordinary suffering. Grief, despair, guilt, shame,
  loneliness, anger, doubt, spiritual dryness, feeling far from God, feeling
  worthless, exhaustion, and wanting to give up ON SOMETHING are all "none".

The distinction that matters: "I can't do this any more" about a job, a
marriage, or faith is NONE. "I can't do this any more" about being alive is
CRISIS. Read for which one they mean, and when it is genuinely ambiguous, choose
the protective answer.

Do not classify a passage of scripture the user is quoting or asking about as a
disclosure about themselves. Someone asking about Job wanting to die, or about
Elijah under the broom tree, is asking about the text.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classification"],
  properties: {
    classification: {
      type: "string",
      enum: ["none", "crisis", "self_harm", "abuse_disclosure"],
    },
  },
} as const;

/**
 * The written responses.
 *
 * Deliberately plain. No scripture, no reframing, no "I hear you" — every one of
 * those is the app doing something with a disclosure instead of getting out of
 * the way. They name a real service, say the app is not the right help, and
 * stop.
 *
 * UK and US numbers are included because those are the launch markets; this list
 * must be revisited before any other market, and a wrong number is worse than no
 * number.
 */
const RESPONSES: Record<Exclude<SafetyClassification, "none">, string> = {
  crisis: `I'm not able to help with this, and I don't want to try — you deserve a real person, right now.

If you're in danger or thinking about ending your life, please contact one of these:

• US — call or text 988 (Suicide & Crisis Lifeline), 24/7
• UK — call 116 123 (Samaritans), free, 24/7
• Emergency services — 911 in the US, 999 in the UK

If you can, tell one person near you tonight. Not because they'll know what to say, but so you aren't the only one holding it.

I'll be here afterwards.`,

  self_harm: `I'm going to stop here, because this needs someone who can actually help — and that isn't an app.

• US — call or text 988 (Suicide & Crisis Lifeline), 24/7
• UK — call 116 123 (Samaritans), free, 24/7

If you have a GP, a doctor, a pastor, or anyone who already knows something about your life, please tell them what you've just told me. Saying it out loud to a person is the part that changes things.

I'll be here when you want to come back.`,

  abuse_disclosure: `Thank you for saying that. I'm not the right help for it, and I don't want to give you a verse instead of getting you to someone who is.

• US — National Domestic Violence Hotline: 1-800-799-7233, or text START to 88788
• UK — National Domestic Abuse Helpline: 0808 2000 247, free, 24/7
• If you are in immediate danger: 911 in the US, 999 in the UK

One thing I want to say plainly, because people in this situation are often told otherwise: what is being done to you is not your fault, and scripture does not ask you to stay somewhere you are being harmed.

Please talk to someone who can help you be safe.`,
};

let client: OpenAI | null = null;
const getClient = (): OpenAI =>
  (client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY }));

/**
 * Obvious phrases that must never depend on a model call succeeding.
 *
 * A pre-filter, NOT the classifier. It exists so that the most unambiguous
 * disclosures are caught even if the API is down, slow, or rate-limited — the
 * moment when a network problem and a person in crisis coincide is exactly the
 * moment that must not fail open.
 */
const HARD_PATTERNS: { pattern: RegExp; classification: SafetyClassification }[] = [
  { pattern: /\bkill (myself|me)\b/i, classification: "crisis" },
  { pattern: /\b(want|going) to die\b/i, classification: "crisis" },
  { pattern: /\bend (my life|it all)\b/i, classification: "crisis" },
  { pattern: /\bsuicid(e|al)\b/i, classification: "crisis" },
  { pattern: /\bno reason to (live|be here)\b/i, classification: "crisis" },
  { pattern: /\b(cut|cutting|burn|burning) myself\b/i, classification: "self_harm" },
  { pattern: /\bhurt myself\b/i, classification: "self_harm" },
];

export async function classifyForSafety(
  message: string,
): Promise<SafetyVerdict> {
  const startedAt = Date.now();

  for (const { pattern, classification } of HARD_PATTERNS) {
    if (pattern.test(message)) {
      logger.warn({ classification }, "safety gate: hard pattern matched");
      return {
        classification,
        blocked: true,
        response: RESPONSES[classification as Exclude<SafetyClassification, "none">],
        modelUsed: "pattern",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  try {
    const response = await getClient().chat.completions.create({
      // The CHEAPEST tier (ARCHITECTURE.md §7): this runs on every single turn
      // and the user is waiting on it.
      model: models.safety,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "safety", strict: true, schema: RESPONSE_SCHEMA },
      },
      max_completion_tokens: 2_000,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        `safety classifier returned empty content (finish_reason=${response.choices[0]?.finish_reason})`,
      );
    }

    const parsed = JSON.parse(content) as { classification: SafetyClassification };
    const classification = parsed.classification;
    const blocked = classification !== "none";

    if (blocked) {
      logger.warn({ classification }, "safety gate fired");
    }

    return {
      classification,
      blocked,
      response: blocked
        ? RESPONSES[classification as Exclude<SafetyClassification, "none">]
        : null,
      modelUsed: models.safety,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    // FAIL CLOSED. An unavailable classifier is not permission to proceed.
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "safety classifier failed — failing CLOSED and returning crisis resources",
    );

    return {
      classification: "crisis",
      blocked: true,
      response: RESPONSES.crisis,
      modelUsed: models.safety,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
      failedClosed: true,
    };
  }
}
