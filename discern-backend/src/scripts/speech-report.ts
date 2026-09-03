// WHAT VOICE COSTS. Reads only; spends nothing.
//
//   npm run speech:report -w @discern/backend
//
// ElevenLabs is the only cost that scales with one user's enthusiasm, so this
// answers the question that decides whether voice ships: what does a spoken
// conversation cost, and how much of it is the cache.

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { env } from "../config/env";
import { ConversationModel, SpeechCacheModel, SpeechUsageModel } from "../models";

async function main(): Promise<void> {
  await connectToDatabase();

  const cache = await SpeechCacheModel.aggregate([
    {
      $group: {
        _id: null,
        rows: { $sum: 1 },
        characters: { $sum: "$characters" },
        hits: { $sum: "$hits" },
        scripture: { $sum: { $cond: [{ $ne: ["$passageReference", null] }, 1, 0] } },
      },
    },
  ]);

  const c = cache[0] ?? { rows: 0, characters: 0, hits: 0, scripture: 0 };

  const usage = await SpeechUsageModel.aggregate([
    {
      $group: {
        _id: null,
        chars: { $sum: "$charactersSynthesized" },
        seconds: { $sum: "$secondsTranscribed" },
        requests: { $sum: "$requests" },
      },
    },
  ]);

  const u = usage[0] ?? { chars: 0, seconds: 0, requests: 0 };
  const ttsUsd = (u.chars / 1000) * env.TTS_USD_PER_1K_CHARS;
  const sttUsd = (u.seconds / 60) * env.STT_USD_PER_MINUTE;

  // Characters that would have been billed had nothing been cached.
  const servedChars = c.characters + c.hits * (c.characters / Math.max(1, c.rows));
  const hitRate = servedChars > 0 ? (servedChars - c.characters) / servedChars : 0;

  const conversations = await ConversationModel.countDocuments();

  console.log("\n" + "═".repeat(80));
  console.log("SPEECH COST");
  console.log("");
  console.log("  SYNTHESIS (TTS)");
  console.log(`    characters billed       ${u.chars.toLocaleString()}`);
  console.log(`    cost                    $${ttsUsd.toFixed(4)}  at $${env.TTS_USD_PER_1K_CHARS}/1k`);
  console.log("");
  console.log("  TRANSCRIPTION (STT) — costed separately");
  console.log(`    seconds billed          ${u.seconds.toLocaleString()}`);
  console.log(`    cost                    $${sttUsd.toFixed(4)}  at $${env.STT_USD_PER_MINUTE}/min`);
  console.log("");
  console.log("  CACHE");
  console.log(`    distinct clips          ${c.rows}`);
  console.log(`    of which scripture      ${c.scripture}`);
  console.log(`    cache hits              ${c.hits}`);
  console.log(`    HIT RATE                ${(hitRate * 100).toFixed(1)}%`);
  console.log(`    characters NOT rebilled ${Math.round(servedChars - c.characters).toLocaleString()}`);
  console.log("");
  console.log("  PER CONVERSATION");
  console.log(`    conversations           ${conversations}`);
  console.log(`    tts + stt per conv      $${((ttsUsd + sttUsd) / Math.max(1, conversations)).toFixed(4)}`);
  console.log("");
  console.log("  CEILINGS");
  console.log(`    tts / user / day        ${env.TTS_DAILY_CHARS_PER_USER.toLocaleString()} chars  (~$${((env.TTS_DAILY_CHARS_PER_USER / 1000) * env.TTS_USD_PER_1K_CHARS).toFixed(2)})`);
  console.log(`    tts / global / day      ${env.TTS_DAILY_CHARS_GLOBAL.toLocaleString()} chars  (~$${((env.TTS_DAILY_CHARS_GLOBAL / 1000) * env.TTS_USD_PER_1K_CHARS).toFixed(2)})`);
  console.log(`    stt / user / day        ${env.STT_DAILY_SECONDS_PER_USER.toLocaleString()}s  (~$${((env.STT_DAILY_SECONDS_PER_USER / 60) * env.STT_USD_PER_MINUTE).toFixed(2)})`);

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
