// Playing a carrying's passage aloud, from the signed S3 url.
//
// SCRIPTURE ONLY. The ruling of 2026-09-03 stands: TTS speaks the passage, and
// her prose only behind the SPEAK_REPLIES flag — so this path, the one attached
// to a carrying, is the one that always exists. It is also the only one that is
// affordable: scripture is identical for every listener and caches permanently,
// so the first person to hear Psalm 46 pays for it and nobody after them does.
//
// THE URL IS SIGNED AND EXPIRES. Fetch it at the moment of play and never
// persist it. A stored url does not fail loudly — it starts 403-ing some time
// later, on a screen that looks fine.
//
// A REFUSAL IS NOT AN ERROR. The daily ceiling comes back as `refusedReason` on
// a perfectly successful response, because "voice is off tonight" is something
// to tell the person rather than something to swallow. `playCarryingPassage`
// returns it instead of throwing.

import { createAudioPlayer } from "expo-audio";
import type { AudioPlayer } from "expo-audio";

import { api } from "./api";

export interface PlaybackResult {
  /** Null when nothing is playing — either refused, or no audio exists. */
  player: AudioPlayer | null;
  reference: string | null;
  translation: string | null;
  /** True when this recording already existed and cost nothing. */
  cached: boolean;
  /** Set when a ceiling declined. Show it; do not treat it as a failure. */
  refusedReason: string | null;
}

/**
 * Fetch and play one carrying's passage.
 *
 * The caller owns the returned player and must `remove()` it when the screen
 * goes away — an audio session left open keeps the app awake and holds the
 * route against whatever plays next.
 */
export async function playCarryingPassage(
  carryingId: string,
  translation?: string,
): Promise<PlaybackResult> {
  const audio = await api.carryingAudio(carryingId, translation);

  if (audio.refusedReason || !audio.url) {
    return {
      player: null,
      reference: audio.reference,
      translation: audio.translation || null,
      cached: audio.cached,
      refusedReason: audio.refusedReason ?? "No audio is available for that passage.",
    };
  }

  const player = createAudioPlayer({ uri: audio.url });
  player.play();

  return {
    player,
    reference: audio.reference,
    translation: audio.translation,
    cached: audio.cached,
    refusedReason: null,
  };
}
