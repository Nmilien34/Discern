// SPEAKING SCRIPTURE. The only thing this app reads aloud.
//
// RULING, 2026-09-03: TTS speaks THE PASSAGE ONLY, never Abigail's prose. Her
// analysis is for reading — it carries references, structure, and the reasoning
// you want to be able to re-scan. The passage is the thing to sit with, and
// sitting with something is what an ear is for.
//
// It is also the only version of this that is affordable. Scripture is
// identical for every listener, so it caches perfectly: the first person to
// hear Psalm 46 pays for it and the ten-thousandth pays nothing. Synthesizing
// her prose meant a fresh bill for every reply — measured at $0.43 against
// $0.018 for the same turn in text, a 24x multiplier on a $27.99/year product.
//
// The cache key is PASSAGE + TRANSLATION + VOICE + SETTINGS, not raw text. Same
// effect, but it means a pregeneration run and a live listen collide on the
// same key rather than producing two objects because of a whitespace
// difference.

import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { PassageModel, TranslationModel } from "../../models";
import { speakable } from "./sentences";
import { synthesize } from "./tts";
import type { SynthesisResult } from "./tts";

export interface PassageAudio {
  reference: string;
  translation: string;
  url: string;
  characters: number;
  cached: boolean;
  refusedReason?: string;
}

/**
 * Audio for one passage, synthesizing it if this is the first time anyone has
 * asked.
 *
 * Returns null when the passage does not exist or has no text; a REFUSAL comes
 * back as a result carrying `refusedReason`, because "voice is off tonight" is
 * something the person should be told rather than an error to swallow.
 */
export async function passageAudio(
  reference: string,
  userId: string,
  translationAbbreviation?: string,
): Promise<PassageAudio | null> {
  if (!env.VOICE_ENABLED) {
    return {
      reference,
      translation: "",
      url: "",
      characters: 0,
      cached: false,
      refusedReason: "Audio is not available on this build.",
    };
  }

  const passage = await PassageModel.findOne({ reference })
    .select("reference texts handling")
    .lean();

  if (!passage) return null;

  // The harm filter applies to the ear as much as the eye. A passage that is
  // never surfaced unprompted is never READ ALOUD unprompted either.
  if (passage.handling === "on-request-only") {
    logger.info({ reference }, "refusing to synthesize an on-request-only passage");
    return null;
  }

  const translation =
    (translationAbbreviation
      ? await TranslationModel.findOne({
          abbreviation: translationAbbreviation.toUpperCase(),
        }).lean()
      : null) ?? (await TranslationModel.findOne({ isDefault: true }).lean());

  if (!translation) return null;

  const texts = passage.texts as unknown as
    | Map<string, string>
    | Record<string, string>;

  const raw =
    texts instanceof Map
      ? texts.get(String(translation._id))
      : texts?.[String(translation._id)];

  const text = speakable(String(raw ?? ""));
  if (!text) return null;

  const result: SynthesisResult | null = await synthesize(text, userId, {
    passageReference: passage.reference,
  });

  if (!result) return null;

  return {
    reference: passage.reference,
    translation: translation.abbreviation,
    url: result.url,
    characters: result.characters,
    cached: result.cached,
    ...(result.refusedReason ? { refusedReason: result.refusedReason } : {}),
  };
}
