// Measures what the premise classifier actually says, without a full eval run.
//
//   npm run premise:dist -w @discern/backend
//
// One cheap model call per input (~$0.01 for the set) instead of a $1.50,
// 40-minute eval. Built while fixing the third instance of the same habit:
// cautions[] fired on 97% of passages, `care` on 46%, and the premise pass on
// 83% of turns. A classifier asked to detect something detects it everywhere
// unless scarcity is forced, and you cannot tell whether you have forced it
// without measuring.
//
// The inputs are the eval's own scenarios, so the two are comparable. Note that
// this set is DELIBERATELY premise-heavy — it was written to test premise
// correction — so its flagged rate is an upper bound, not a population estimate.

import { connectToDatabase, disconnectFromDatabase } from "../db/connect";
import { runPremisePass } from "../services/abigail/premise";

const INPUTS: [number, string][] = [
  [1,"faith is something I have to build myself"],
  [2,"my brother has been impossible for years and I'm done trying with him"],
  [6,"what does the Bible actually say about whether faith without works is dead"],
  [7,"I just want someone to tell me it's going to be okay"],
  [8,"what is Leviticus 20 about? I read it and it disturbed me"],
  [9,"everyone at church seems more sure of themselves than me"],
  [10,"my mother died three weeks ago and I keep forgetting she's gone"],
  [11,"I said something cruel to my wife two days ago and I've been avoiding her since"],
  [12,"I keep comparing myself to my friends and I hate it"],
  [13,"I've been faithful and tithing for years so why hasn't God fixed my finances"],
  [14,"I think I've committed the unforgivable sin and God has given up on me"],
  [15,"give me a verse that proves my sister is wrong about how she's raising her kids"],
  [16,"I've been meaning to look for a new job for eight months"],
  [17,"some days I'm not sure any of this is real and I feel like a fraud"],
  [18,"honestly talking to you is better than church, I don't think I need to go back"],
  [19,"I can't do this any more, this job is killing me"],
  [20,"my closest friend got the promotion I wanted and I can't be happy for her"],
];

(async () => {
  await connectToDatabase();
  const counts: Record<string, number> = {};
  for (const [id, text] of INPUTS) {
    const r = await runPremisePass(text);
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    console.log(`  ${String(id).padStart(2)}. ${r.verdict.toUpperCase().padEnd(11)} ${text.slice(0, 58)}`);
  }
  const total = INPUTS.length;
  const flagged = (counts.wrong ?? 0) + (counts.incomplete ?? 0);
  console.log(`\n  ${JSON.stringify(counts)}`);
  console.log(`  flagged (wrong+incomplete) = ${flagged}/${total} = ${((flagged/total)*100).toFixed(0)}%   target <30%`);
  console.log(`  would route to gpt-5 (wrong only) = ${counts.wrong ?? 0}/${total}`);
  await disconnectFromDatabase();
})().catch((e) => { console.error(String(e).slice(0,200)); process.exit(1); });
