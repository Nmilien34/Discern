// Provisions tester links for the THROWAWAY test client. Delete with it.
//
//   npm run testers -w @discern/backend -- --count 6 --base https://discern-api.onrender.com
//   npm run testers -w @discern/backend -- --list
//   npm run testers -w @discern/backend -- --revoke
//
// WHY EACH TESTER GETS THEIR OWN LINK, rather than one shared token.
//
// `passagesGiven`, user memory, the current stage and the three-carrying cap
// are all PER USER. Six people behind one account would share all of it: the
// third person's conversation would be shaped by the first person's, Abigail
// would refuse to re-offer a passage because someone else already had it, and
// the carrying cap would be full before most of them started. It would also be
// impossible to tell whose transcript was whose afterwards.
//
// So: one user per tester, one link per tester, named so the transcripts can be
// attributed. The token rides in the URL FRAGMENT (#t=...), which browsers do
// not send to servers and which therefore never lands in an access log or a
// Referer header.
//
// THIS GRANTS ACCESS WITHOUT PAYMENT. That is the point — a tester cannot buy a
// subscription for an app that does not exist in a store yet — but it is why
// this lives in a script that names its own database rather than anywhere a
// request can reach.

import mongoose from "mongoose";

import { issueToken } from "../auth/tokens";
import {
  assertCorpusWritable,
  connectToDatabase,
  disconnectFromDatabase,
} from "../db/connect";
import { ConversationModel, UserModel } from "../models";

/** The marker that makes a tester findable, listable and revocable. */
const TESTER_PREFIX = "tester-";

const DEFAULT_COUNT = 6;
const TRIAL_DAYS = 30;

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const hasFlag = (flag: string): boolean => process.argv.includes(flag);

async function list(base: string): Promise<void> {
  const testers = await UserModel.find({
    deviceId: new RegExp(`^${TESTER_PREFIX}`),
  })
    .sort({ createdAt: 1 })
    .lean();

  if (testers.length === 0) {
    console.log("No testers. Run with --count N to make some.");
    return;
  }

  console.log(`\n${testers.length} tester${testers.length === 1 ? "" : "s"}:\n`);

  for (const t of testers) {
    const conversations = await ConversationModel.countDocuments({
      userId: t._id,
    });
    const expires = t.entitlement.expiresAt;
    const live = expires ? expires.getTime() > Date.now() : false;

    console.log(
      `  ${t.deviceId.padEnd(14)} ` +
        `${String(conversations).padStart(2)} conversation${conversations === 1 ? " " : "s"}  ` +
        `${live ? "access ok " : "EXPIRED   "}` +
        `${expires ? expires.toISOString().slice(0, 10) : "no expiry"}`,
    );
    // Tokens are re-issued rather than stored: the user id is the durable
    // thing, and a JWT is cheap to mint again.
    console.log(`    ${base}/test#t=${issueToken(String(t._id))}\n`);
  }
}

async function main(): Promise<void> {
  await connectToDatabase();
  assertCorpusWritable("make-testers");

  const base = (argOf("--base") ?? "http://localhost:8080").replace(/\/+$/, "");

  if (hasFlag("--revoke")) {
    // Expires access. Does NOT delete the users, because deleting them would
    // take the transcripts with them — which are the entire point of the test.
    const result = await UserModel.updateMany(
      { deviceId: new RegExp(`^${TESTER_PREFIX}`) },
      {
        $set: {
          "entitlement.status": "expired",
          "entitlement.expiresAt": new Date(0),
        },
      },
    );
    console.log(
      `Revoked access for ${result.modifiedCount} tester(s). ` +
        "Their conversations are untouched — read them with `npm run transcripts`.",
    );
    await disconnectFromDatabase();
    return;
  }

  if (hasFlag("--list")) {
    await list(base);
    await disconnectFromDatabase();
    return;
  }

  const count = Number(argOf("--count") ?? DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error(`--count must be an integer from 1 to 50, got "${count}"`);
  }

  const existing = await UserModel.countDocuments({
    deviceId: new RegExp(`^${TESTER_PREFIX}`),
  });

  const expiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  for (let i = 0; i < count; i += 1) {
    const deviceId = `${TESTER_PREFIX}${String(existing + i + 1).padStart(2, "0")}`;

    await UserModel.findOneAndUpdate(
      { deviceId },
      {
        $setOnInsert: { deviceId },
        $set: {
          // `trialing` is a real paid status, so these accounts exercise the
          // same gate a real subscriber does. Nothing about the entitlement
          // path is bypassed or special-cased for them.
          "entitlement.status": "trialing",
          "entitlement.expiresAt": expiresAt,
          "entitlement.verificationState": "verified",
          "entitlement.willRenew": false,
          lastActiveAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  }

  console.log(
    `\n${count} tester link${count === 1 ? "" : "s"}, valid ${TRIAL_DAYS} days. ` +
      "Give ONE PER PERSON — they are separate accounts on purpose.\n",
  );

  await list(base);

  console.log(
    "Every conversation is saved. Read them with:\n" +
      "  npm run transcripts -w @discern/backend\n\n" +
      "Revoke all access when testing ends (transcripts are kept):\n" +
      "  npm run testers -w @discern/backend -- --revoke\n",
  );

  await disconnectFromDatabase();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    void mongoose.disconnect().finally(() => process.exit(1));
  });
}
