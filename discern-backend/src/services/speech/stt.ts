// SPEECH TO TEXT — voice INPUT.
//
// Costed and reported SEPARATELY from TTS, because they are different products
// with different economics and the decision they inform is different. Speaking
// the problem out loud is closer to the original idea than hearing the answer
// read back, and the two should be able to ship independently.
//
// Billed per minute rather than per character, so the ceiling counts seconds.
// Duration is not knowable before upload, so it is estimated from the byte
// length against the encoding's bitrate and reconciled after — an
// over-estimate reserves too much and refunds, which errs toward the ceiling.

import { env, voiceConfig } from "../../config/env";
import { logger } from "../../lib/logger";
import { releaseSpeechSpend, reserveSpeechSpend } from "./spend";

const API = "https://api.elevenlabs.io/v1";

/** Rough, and deliberately generous — over-reserving is the safe direction. */
const ASSUMED_BITRATE_BYTES_PER_SECOND = 16_000;

export interface TranscriptionResult {
  text: string;
  seconds: number;
  refusedReason?: string;
}

export async function transcribe(
  audio: Uint8Array,
  userId: string,
  filename = "input.webm",
): Promise<TranscriptionResult> {
  const estimatedSeconds = Math.max(
    1,
    Math.ceil(audio.byteLength / ASSUMED_BITRATE_BYTES_PER_SECOND),
  );

  const decision = await reserveSpeechSpend(userId, "stt", estimatedSeconds, "serving");

  if (!decision.allowed) {
    return {
      text: "",
      seconds: 0,
      refusedReason:
        decision.reason ?? "Voice input is unavailable right now. Type instead.",
    };
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([audio as BlobPart]), filename);
    form.append("model_id", env.ELEVENLABS_STT_MODEL);

    const response = await fetch(`${API}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": voiceConfig().apiKey },
      body: form,
    });

    if (!response.ok) {
      throw new Error(
        `ElevenLabs STT returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as { text?: string };

    return { text: (body.text ?? "").trim(), seconds: estimatedSeconds };
  } catch (error) {
    await releaseSpeechSpend(userId, "stt", estimatedSeconds, "serving");
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "transcription failed; reservation released",
    );
    return {
      text: "",
      seconds: 0,
      refusedReason: "That recording could not be transcribed. Try typing it.",
    };
  }
}
