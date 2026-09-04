// TEXT TO SPEECH, CACHED BY CONTENT AND BOUNDED BY THE CEILING.
//
// Order of operations matters and is not negotiable:
//
//   1. hash the text with the voice and every setting
//   2. cache hit?  -> return, NOTHING is spent and no ceiling is touched
//   3. reserve against the ceiling  -> refused? return null, caller uses text
//   4. synthesize, store in S3, record the cache row
//   5. provider failed? release the reservation
//
// The cache comes before the ceiling on purpose. Scripture is the same every
// time it is read, so the hundredth person to be handed Psalm 46 costs nothing
// and must not consume anyone's daily allowance to hear it.

import crypto from "node:crypto";

import { env, voiceConfig } from "../../config/env";
import { logger } from "../../lib/logger";
import { SpeechCacheModel } from "../../models";
import { audioUrl, putAudio, speechKey } from "./storage";
import { releaseSpeechSpend, reserveSpeechSpend } from "./spend";
import type { SpendScope, SpeechPurpose } from "./spend";

const API = "https://api.elevenlabs.io/v1";

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

/** From config, never hardcoded — `style` is tuned by ear, not by deploy. */
export function voiceSettings(): VoiceSettings {
  return {
    stability: env.ELEVENLABS_STABILITY,
    similarity_boost: env.ELEVENLABS_SIMILARITY_BOOST,
    style: env.ELEVENLABS_STYLE,
    use_speaker_boost: env.ELEVENLABS_SPEAKER_BOOST,
    speed: env.ELEVENLABS_SPEED,
  };
}

/**
 * Identity of a piece of audio.
 *
 * Everything that could change what comes back is in here, so re-tuning the
 * voice cannot serve yesterday's recording — the hash simply stops matching and
 * the old rows age out.
 */
function audioHash(text: string): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text: text.trim(),
        voice: voiceConfig().voiceId,
        model: env.ELEVENLABS_TTS_MODEL,
        settings: voiceSettings(),
      }),
    )
    .digest("hex");
}

export interface SynthesisResult {
  url: string;
  s3Key: string;
  characters: number;
  cached: boolean;
  /** Set when the ceiling refused. The caller shows this and stays on text. */
  refusedReason?: string;
  /**
   * WHICH ceiling refused, so a caller can tell a one-off from a stop.
   *
   * "per-request" means THIS passage is too long and the next one may be fine.
   * "user-daily" and "global-daily" mean everything after this is refused too.
   * A bulk run that cannot tell them apart stops on the first long passage —
   * which is exactly what happened to the corpus pregeneration at 952 of 3,879.
   */
  refusedLimit?: "user-daily" | "global-daily" | "per-request" | "bulk-daily";
}

/**
 * Synthesize one piece of text, or explain why not.
 *
 * Returns null ONLY when there was nothing to say. A refusal comes back as a
 * result carrying `refusedReason`, because "voice is off tonight" is
 * information the person should get, not an error to swallow.
 */
export async function synthesize(
  text: string,
  userId: string,
  options: {
    passageReference?: string;
    translationId?: string;
    /**
     * Which ledger this spends from. EXPLICIT, never inferred.
     *
     * Defaults to "serving" so a caller that forgets cannot accidentally draw
     * on the large operator budget — the safe direction is the tight one.
     */
    scope?: SpendScope;
    /**
     * Scripture or her own prose. Reporting only — the ceiling is shared.
     *
     * Defaults to "scripture" because that was the only caller for a day, and
     * a mislabelled scripture line is far less dangerous than prose hiding
     * inside the number that is supposed to plateau.
     */
    purpose?: SpeechPurpose;
  } = {},
): Promise<SynthesisResult | null> {
  const clean = text.trim();
  if (!clean) return null;

  const hash = audioHash(clean);

  // ---- 1. CACHE FIRST. A hit spends nothing and consumes no allowance.
  const cached = await SpeechCacheModel.findOneAndUpdate(
    { hash },
    { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } },
    { new: true },
  );

  if (cached) {
    return {
      url: await audioUrl(cached.s3Key),
      s3Key: cached.s3Key,
      characters: cached.characters,
      cached: true,
    };
  }

  // ---- 2. THE CEILING, before a single character is sent.
  const scope: SpendScope = options.scope ?? "serving";
  const purpose: SpeechPurpose = options.purpose ?? "scripture";

  const decision = await reserveSpeechSpend(
    userId,
    "tts",
    clean.length,
    scope,
    purpose,
  );

  if (!decision.allowed) {
    return {
      url: "",
      s3Key: "",
      characters: 0,
      cached: false,
      refusedReason: decision.reason ?? "Spoken replies are unavailable.",
      ...(decision.limit ? { refusedLimit: decision.limit } : {}),
    };
  }

  try {
    const response = await fetch(
      `${API}/text-to-speech/${voiceConfig().voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": voiceConfig().apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: clean,
          model_id: env.ELEVENLABS_TTS_MODEL,
          voice_settings: voiceSettings(),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const audio = new Uint8Array(await response.arrayBuffer());
    const key = speechKey("tts", hash);
    await putAudio(key, audio);

    // Upsert rather than create: two turns can race on the same sentence, and
    // losing that race should cost a duplicate S3 write, not a 500.
    await SpeechCacheModel.updateOne(
      { hash },
      {
        $setOnInsert: {
          hash,
          s3Key: key,
          characters: clean.length,
          voiceId: voiceConfig().voiceId,
          passageReference: options.passageReference ?? null,
          translationId: options.translationId ?? null,
        },
      },
      { upsert: true },
    );

    return {
      url: await audioUrl(key),
      s3Key: key,
      characters: clean.length,
      cached: false,
    };
  } catch (error) {
    // The characters were reserved and never spent. Give them back, or a
    // provider outage silently eats somebody's daily allowance.
    await releaseSpeechSpend(userId, "tts", clean.length, scope);

    logger.error(
      { err: error instanceof Error ? error.message : error, characters: clean.length },
      "speech synthesis failed; reservation released",
    );

    return {
      url: "",
      s3Key: "",
      characters: 0,
      cached: false,
      refusedReason: "Audio is unavailable just now. Her reply is here in text.",
    };
  }
}
