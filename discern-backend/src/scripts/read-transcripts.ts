// Reads what the testers actually said. Delete with the test client.
//
//   npm run transcripts -w @discern/backend
//   npm run transcripts -w @discern/backend -- --who tester-03
//   npm run transcripts -w @discern/backend -- --since 2026-09-05
//
// The backend already persists every turn — this script does not add logging,
// it just makes the existing record readable. Each turn prints with the routing
// facts alongside it (model, safety classification, citations), because "she
// said something odd" and "she said something odd on the cheap tier with no
// passage retrieved" are different findings.
//
// PRINTS EVERY WORD SOMEONE TYPED. Read it somewhere private.

import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { ConversationModel, MessageModel, UserModel } from "../models";

const TESTER_PREFIX = "tester-";

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function wrap(text: string, indent: string, width = 84): string {
  return text
    .split("\n")
    .flatMap((paragraph) => {
      if (paragraph.trim() === "") return [""];
      const out: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && (line + " " + word).length > width) {
          out.push(line);
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      }
      if (line) out.push(line);
      return out;
    })
    .map((l) => indent + l)
    .join("\n");
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertCorpusWritable("read-transcripts");

  const who = argOf("--who");
  const sinceArg = argOf("--since");
  const since = sinceArg ? new Date(sinceArg) : null;

  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since must be a date, got "${sinceArg}"`);
  }

  const testers = await UserModel.find({
    deviceId: who ? who : new RegExp(`^${TESTER_PREFIX}`),
  })
    .sort({ deviceId: 1 })
    .lean();

  if (testers.length === 0) {
    console.log(
      who
        ? `No tester "${who}".`
        : "No testers yet. Make some with `npm run testers`.",
    );
    await disconnectFromDatabase();
    return;
  }

  let totalConversations = 0;
  let totalTurns = 0;
  let safetyFired = 0;
  const modelCounts = new Map<string, number>();

  for (const tester of testers) {
    const conversations = await ConversationModel.find({
      userId: tester._id,
      ...(since ? { startedAt: { $gte: since } } : {}),
    })
      .sort({ startedAt: 1 })
      .lean();

    if (conversations.length === 0) continue;

    console.log("\n" + "█".repeat(90));
    console.log(`${tester.deviceId} — ${conversations.length} conversation(s)`);

    for (const conversation of conversations) {
      const messages = await MessageModel.find({
        conversationId: conversation._id,
      })
        .sort({ createdAt: 1 })
        .lean();

      if (messages.length === 0) continue;

      totalConversations += 1;

      console.log("\n" + "─".repeat(90));
      console.log(
        `${conversation.startedAt.toISOString().replace("T", " ").slice(0, 16)}  ` +
          `${conversation.mode}  ${messages.length} messages`,
      );

      for (const m of messages) {
        console.log("");
        if (m.role === "user") {
          totalTurns += 1;
          console.log(wrap(m.content, "  > "));
        } else {
          const model = m.modelUsed ?? "unrecorded";
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
          if (m.safetyIntercepted) safetyFired += 1;

          const meta =
            `[${model}` +
            `${m.safetyIntercepted ? " SAFETY-INTERCEPTED" : ""}` +
            `${m.citations.length ? " " + m.citations.map((c) => c.ref).join(", ") : " no passage"}]`;
          console.log(`  ${meta}`);
          console.log(wrap(m.content, "    "));
        }
      }
    }
  }

  console.log("\n" + "═".repeat(90));
  console.log(
    `  ${totalConversations} conversation(s), ${totalTurns} turn(s) from ` +
      `${testers.length} tester account(s)`,
  );
  if (safetyFired > 0) {
    // Worth surfacing on its own line. Someone disclosed something the gate
    // caught, and that is the single most important thing in the file.
    console.log(`  SAFETY GATE FIRED ${safetyFired} time(s) — read those turns.`);
  }
  console.log(
    "  models  " +
      ([...modelCounts.entries()].map(([k, v]) => `${k}=${v}`).join("  ") ||
        "none"),
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
