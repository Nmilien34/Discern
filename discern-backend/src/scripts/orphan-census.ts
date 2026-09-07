// READ ONLY. Census of rows stranded by the pre-2026-09-06 merge registry.
//
//   npx tsx src/scripts/orphan-census.ts
//
// `processedWebhookEvents` and `speechUsage` were in neither the merge list nor
// the deletion list until 2026-09-06, so every account link since Phase 7 left
// their rows behind. Kept as a standing diagnostic rather than deleted: the
// first census returned ZERO merge orphans only because merge had barely been
// exercised — two merges, both test accounts that owned nothing. Real merges
// will happen, and this answers "did anything get stranded" in one command.
//
// NOT ALL `user:` SCOPES ARE USER IDS. `speechUsage` carries `user:pregen`,
// `user:probe`, `user:t-<random>` and other scaffolding from scripts and tests.
// The first run of this census counted all sixteen of them as orphaned users.
// They are excluded by shape now: a real scope carries a 24-character hex id.
import path from "node:path";

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string, { dbName: "discern" });
  const db = mongoose.connection.db!;

  const users = await db.collection("users").find({})
    .project({ _id: 1, accountId: 1, mergedIntoUserId: 1, deviceId: 1, entitlement: 1 }).toArray();
  const live = new Map(users.map((u) => [String(u._id), u]));
  const merged = users.filter((u) => u.mergedIntoUserId);

  console.log("users:", users.length);
  console.log("  with an accountId (linked):", users.filter((u) => u.accountId).length);
  console.log("  MERGED AWAY (mergedIntoUserId set):", merged.length);
  console.log("  paying now (trialing/active/active_canceled):",
    users.filter((u) => ["trialing", "active", "active_canceled"].includes(u.entitlement?.status)).length);

  // ── processedWebhookEvents ────────────────────────────────────────────────
  const pwe = await db.collection("processedwebhookevents").find({})
    .project({ _id: 1, userId: 1, eventType: 1, detachedAt: 1 }).toArray();
  const withUser = pwe.filter((r) => r.userId);
  const gone = withUser.filter((r) => !live.has(String(r.userId)));
  const toMerged = withUser.filter((r) => live.get(String(r.userId))?.mergedIntoUserId);

  console.log("\nprocessedWebhookEvents:", pwe.length, " with a userId:", withUser.length);
  console.log("  userId no longer resolves to any user:", gone.length);
  console.log("  userId resolves to a MERGED-AWAY user:", toMerged.length);
  console.log("  already detached:", pwe.filter((r) => r.detachedAt).length);

  // ── speechUsage ───────────────────────────────────────────────────────────
  const su = await db.collection("speechusages").find({})
    .project({ _id: 1, scope: 1, day: 1, charactersSynthesized: 1 }).toArray();
  const OBJECT_ID = /^[0-9a-f]{24}$/i;
  const scopeId = (scope: unknown): string | null => {
    const raw = String(scope);
    if (!raw.startsWith("user:")) return null;
    const id = raw.slice(5);
    return OBJECT_ID.test(id) ? id : null;
  };
  const scaffolding = su.filter((r) => String(r.scope).startsWith("user:") && !scopeId(r.scope));
  const userScoped = su.filter((r) => scopeId(r.scope) !== null);
  const suGone = userScoped.filter((r) => !live.has(scopeId(r.scope) as string));
  const suMerged = userScoped.filter((r) => live.get(scopeId(r.scope) as string)?.mergedIntoUserId);

  console.log("\nspeechUsage:", su.length, " real user scopes:", userScoped.length,
    " scaffolding scopes ignored:", scaffolding.length,
    `(${scaffolding.map((r) => String(r.scope)).slice(0, 4).join(", ")}${scaffolding.length > 4 ? ", …" : ""})`);
  console.log("  scope points at no user:", suGone.length);
  console.log("  scope points at a MERGED-AWAY user:", suMerged.length);

  // ── affected accounts ─────────────────────────────────────────────────────
  const affectedSurvivors = new Set<string>();
  for (const r of [...gone, ...toMerged]) {
    const u = live.get(String(r.userId));
    if (u?.mergedIntoUserId) affectedSurvivors.add(String(u.mergedIntoUserId));
  }
  for (const r of [...suGone, ...suMerged]) {
    const u = live.get(scopeId(r.scope) as string);
    if (u?.mergedIntoUserId) affectedSurvivors.add(String(u.mergedIntoUserId));
  }

  console.log("\ndistinct SURVIVING accounts affected:", affectedSurvivors.size);
  for (const id of affectedSurvivors) {
    const u = live.get(id);
    console.log(`   ${id}  status=${u?.entitlement?.status ?? "?"}  linked=${Boolean(u?.accountId)}`);
  }
  const paying = [...affectedSurvivors].filter((id) =>
    ["trialing", "active", "active_canceled"].includes(live.get(id)?.entitlement?.status));
  console.log("  of those, currently paying:", paying.length);

  await mongoose.disconnect();
}
void main();
