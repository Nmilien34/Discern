// Sliced passages, and the quotation marks slicing leaves behind.

import { describe, expect, it } from "vitest";

import { balanceBlockQuotes, hasUnclosedQuotation } from "../lib/quote-balance";

// The real case, verbatim from the corpus.
const LUKE_14_10_11 =
  "But when you are invited, go and sit in the lowest place, so that when he " +
  "who invited you comes, he may tell you, ‘Friend, move up higher.’ " +
  "Then you will be honored in the presence of all who sit at the table with " +
  "you. For everyone who exalts himself will be humbled, and whoever humbles " +
  "himself will be exalted.”";

describe("balanceBlockQuotes", () => {
  it("removes a closing mark whose opener was not in the slice", () => {
    const out = balanceBlockQuotes(LUKE_14_10_11);
    expect(out.endsWith("will be exalted.")).toBe(true);
    expect(out).not.toContain("”");
  });

  it("LEAVES NESTED SPEECH ALONE", () => {
    // WEB puts speech inside speech in single marks, and Luke 14:10 has one:
    // the host saying "Friend, move up higher." It balances, it is inside the
    // slice, and it is part of the sentence.
    const out = balanceBlockQuotes(LUKE_14_10_11);
    expect(out).toContain("‘Friend, move up higher.’");
  });

  it("keeps a LEADING opening mark too, even with nothing before it", () => {
    // Luke 14:8 as a slice. There is no attribution in front of it here, so
    // this is the most sympathetic case for removal — and it is still not
    // removed, because one rule that can be stated is worth more than a
    // heuristic about whether a speaker was named. Opt in per call.
    const sliced = "“When you are invited by anyone to a wedding feast, don't sit in the best seat";
    expect(balanceBlockQuotes(sliced)).toBe(sliced);
    expect(balanceBlockQuotes(sliced, { openers: "remove" })).toBe(
      "When you are invited by anyone to a wedding feast, don't sit in the best seat",
    );
  });

  it("leaves a balanced passage completely untouched", () => {
    // Matthew 26:33, which needs nothing.
    const balanced =
      "But Peter answered him, “Even if all will be made to stumble because " +
      "of you, I will never be made to stumble.”";
    expect(balanceBlockQuotes(balanced)).toBe(balanced);
  });

  it("leaves a passage with SEVEN balanced pairs untouched", () => {
    // Matthew 26:69-75 opens and closes seven times.
    const many = Array.from(
      { length: 7 },
      (_u, i) => `He said, “line ${i}.”`,
    ).join(" ");
    expect(balanceBlockQuotes(many)).toBe(many);
  });

  it("LEAVES an unmatched opening mark alone by default", () => {
    // Measured across the WEB corpus: 291 pericopes have a stray closer, 951
    // have a stray opener, and the two are not the same problem. Every sampled
    // opener has this shape — the attribution is IN the passage, so deleting
    // the mark turns direct speech into narration.
    const said = "God said, “What have you done? The voice of your brother’s blood cries to me";
    expect(balanceBlockQuotes(said)).toBe(said);
  });

  it("removes an unmatched OPENING mark only when explicitly asked", () => {
    // Matthew 8:8-10 in WEB, verbatim and abridged. Verse 10 opens Jesus's
    // reply mid-block and the speech continues into verse 11, which is not
    // cited — so the “ sits in the middle of the text with its closer outside
    // the slice entirely.
    //
    // THIS TEST REPLACES ONE THAT ASSERTED THE OPPOSITE. The original rule
    // removed marks only at the very edge, on the theory that a mark in the
    // middle was a source defect rather than a slicing artefact. Matthew 8:8-10
    // is the counter-example, and the corpus settled it: 1,242 of 4,090 stored
    // pericopes (30.4%) are unbalanced in WEB, because segmentation cuts
    // speeches. An unmatched mark is overwhelmingly a cut speech.
    const matthew =
      "The centurion answered, “Lord, I’m not worthy for you to come under my " +
      "roof.” When Jesus heard it, he marveled and said to those who followed, " +
      "“Most certainly I tell you, I haven’t found so great a faith, not even in Israel.";

    const out = balanceBlockQuotes(matthew, { openers: "remove" });
    // The centurion's balanced pair survives untouched...
    expect(out).toContain("“Lord, I’m not worthy for you to come under my roof.”");
    // ...and the unterminated one is gone.
    expect(out).toContain("Most certainly I tell you");
    expect(out).not.toContain("“Most certainly");
  });

  it("never touches nested single marks, or the apostrophes that share the glyph", () => {
    // 2 Kings 5:10-12: Naaman quoting the scene he had written for himself,
    // single marks inside double, alongside "Aren’t" and "Couldn’t".
    const naaman =
      "But Naaman was angry, and went away and said, “Behold, I thought, ‘He " +
      "will surely come out to me.’ Aren’t Abanah and Pharpar better? Couldn’t " +
      "I wash in them and be clean?”";
    expect(balanceBlockQuotes(naaman)).toBe(naaman);
  });

  it("handles text with no marks at all", () => {
    const plain = "Every way of a man is right in his own eyes, but Yahweh weighs the hearts.";
    expect(balanceBlockQuotes(plain)).toBe(plain);
  });

  it("is idempotent", () => {
    const once = balanceBlockQuotes(LUKE_14_10_11);
    expect(balanceBlockQuotes(once)).toBe(once);
  });
});

describe("hasUnclosedQuotation — what decides the continuation affordance", () => {
  it("is true only when a speech actually runs off the end", () => {
    expect(hasUnclosedQuotation("God said, “I will bring an end to all flesh")).toBe(true);
    expect(hasUnclosedQuotation("God said, “I will bring an end.”")).toBe(false);
    expect(hasUnclosedQuotation("Every way of a man is right in his own eyes.")).toBe(false);
  });

  it("is FALSE for a stray closer, which is the other problem entirely", () => {
    // Luke 14:10-11. The opener is in v8, which is not cited. That mark is
    // deleted by balanceBlockQuotes; it does not earn an affordance, because
    // the speech does not continue — it already ended here.
    expect(hasUnclosedQuotation("…and whoever humbles himself will be exalted.”")).toBe(false);
  });

  it("handles the mixed case: balanced pairs plus one that runs on", () => {
    // Matthew 8:8-10 — the centurion's speech closes, Jesus's does not.
    expect(
      hasUnclosedQuotation(
        "The centurion answered, “Lord, I’m not worthy.” When Jesus heard it he said, “Most certainly I tell you",
      ),
    ).toBe(true);
  });

  it("ignores nested single marks and apostrophes", () => {
    expect(
      hasUnclosedQuotation("“Behold, I thought, ‘He will surely come out.’ Aren’t they better?”"),
    ).toBe(false);
  });
});
