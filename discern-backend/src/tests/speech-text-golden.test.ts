// GOLDEN FILE OVER THE SPEECH TEXT TRANSFORM.
//
// THE AUDIO CACHE KEY IS A HASH OF THE TEXT. So any change to how text is
// spoken orphans every recording made before it — silently, because nothing
// fails and the next synthesis simply pays again. That is not hypothetical:
//
//   2026-09-04 02:10 UTC  49ce559 "Speak references the way a person says them"
//                         changed the text and orphaned everything before it.
//   2026-09-04 02:50 UTC  a failed deploy dropped six ElevenLabs settings and
//                         orphaned the rest.
//
// Between them, 7,829 of 7,830 rows — roughly $2,282 of synthesis — stopped
// matching. It was found three days later by noticing a cache miss, and the
// TEXT half of it was found only after 426 million hash candidates failed to
// explain the settings half.
//
// SO THIS TEST EXISTS TO MAKE THAT NOISY. It does not assert that the output
// below is correct — it asserts that it has not changed. A failure here is not
// a bug: it means the author is orphaning the cache, and the right response is
// to read the diff, decide the change is worth the re-synthesis, and update
// these constants deliberately.
//
// A FULL RE-SYNTHESIS IS ROUGHLY $2,280. Put that number in the commit message.
//
// Baseline captured 2026-09-07, after the pilcrow migration. Hermetic: the
// inputs are pinned too, so it needs no database.

import { describe, expect, it } from "vitest";

import { speakableProse, speakReference } from "../services/speech/reference-speech";
import { speakable } from "../services/speech/sentences";

/**
 * Real corpus text, pinned as input. Chosen to span what actually varies:
 * poetry and the divine name, nested quoted speech, a speech that runs off the
 * end of the passage, and terse parallel lines.
 */
const PSALM_27 =
  "Yahweh is my light and my salvation. Whom shall I fear? Yahweh is the strength of my life. Of whom shall I be afraid? When evildoers came at me to eat up my flesh, even my adversaries and my foes, they stumbled and fell. Though an army should encamp against me, my heart shall not fear. Though war should rise against me, even then I will be confident. One thing I have asked of Yahweh, that I will seek after: that I may dwell in Yahweh’s house all the days of my life, to see Yahweh’s beauty, and to inquire in his temple. For in the day of trouble, he will keep me secretly in his pavilion. In the secret place of his tabernacle, he will hide me. He will lift me up on a rock. Now my head will be lifted up above my enemies around me. I will offer sacrifices of joy in his tent. I will sing, yes, I will sing praises to Yahweh. Hear, Yahweh, when I cry with my voice. Have mercy also on me, and answer me. When you said, “Seek my face,” my heart said to you, “I will seek your face, Yahweh.” Don’t hide your face from me. Don’t put your servant away in anger. You have been my help. Don’t abandon me, neither forsake me, God of my salvation. When my father and my mother forsake me, then Yahweh will take me up. Teach me your way, Yahweh. Lead me in a straight path, because of my enemies. Don’t deliver me over to the desire of my adversaries, for false witnesses have risen up against me, such as breathe out cruelty. I am still confident of this: I will see the goodness of Yahweh in the land of the living. Wait for Yahweh. Be strong, and let your heart take courage. Yes, wait for Yahweh.";

const JOB_38 =
  "Then Yahweh answered Job out of the whirlwind, “Who is this who darkens counsel by words without knowledge? Brace yourself like a man, for I will question you, then you answer me! “Where were you when I laid the foundations of the earth? Declare, if you have understanding. Who determined its measures, if you know? Or who stretched the line on it? What were its foundations fastened on? Or who laid its cornerstone,";

const PROVERBS_21 =
  "The king’s heart is in Yahweh’s hand like the watercourses. He turns it wherever he desires. Every way of a man is right in his own eyes, but Yahweh weighs the hearts. To do righteousness and justice is more acceptable to Yahweh than sacrifice. A high look and a proud heart, the lamp of the wicked, is sin. The plans of the diligent surely lead to profit; and everyone who is hasty surely rushes to poverty. Getting treasures by a lying tongue is a fleeting vapor for those who seek death. The violence of the wicked will drive them away, because they refuse to do what is right. The way of the guilty is devious, but the conduct of the innocent is upright. It is better to dwell in the corner of the housetop than to share a house with a contentious woman. The soul of the wicked desires evil; his neighbor finds no mercy in his eyes.";

const CORPUS: [string, string, number][] = [
  ["Psalms 27:1-14 WEB — poetry, and the passage the drift was found on", PSALM_27, 1596],
  ["Job 38:1-6 WEB — a speech that opens and never closes", JOB_38, 416],
  ["Proverbs 21:1-10 WEB — terse parallel lines, semicolons", PROVERBS_21, 836],
];

describe("passage text, as it is handed to the synthesiser", () => {
  it("is unchanged, character for character", () => {
    // `speakable` is close to a pass-through on scripture — its strip rules
    // target HER PROSE. That is exactly why a change here is easy to make by
    // accident and expensive when made: a rule written for a reply reshapes
    // 4,102 passages.
    for (const [label, text] of CORPUS) expect(speakable(text).trim(), label).toBe(text);
  });

  it("pins the character counts, which are what the cache paid for", () => {
    for (const [label, text, length] of CORPUS) {
      expect(speakable(text).trim().length, label).toBe(length);
    }
  });

  it("NO PILCROW SURVIVES, in the inputs or the output", () => {
    // 1,982 passages carried one in `passages.texts[KJV]` until 2026-09-07,
    // because the first migration cleaned `verses` and left the joined copy
    // that synthesis actually reads. Speaking one costs money twice: once to
    // narrate it, and again to re-synthesise after it is removed.
    const kjv = "¶ When thou art bidden of any man to a wedding, sit not down in the highest room;";
    expect(speakable(kjv)).not.toContain("¶");
    for (const [, text] of CORPUS) expect(text).not.toContain("¶");
  });
});

describe("her prose, where the strip rules actually fire", () => {
  const CASES: [string, string][] = [
    [
      "- She gave you Psalm 27 (see Psalm 27:1, 13-14) because you kept waiting.",
      "She gave you Psalm 27 because you kept waiting.",
    ],
    ["**Wait** for `Yahweh`. (Ps. 27:14)  Be strong.", "Wait for Yahweh. Be strong."],
    [
      // Removing a parenthetical leaves a stranded period, which reads aloud as
      // a pause and a swallowed click.
      'He said, "Whom shall I fear?" . Then nothing.',
      'He said, "Whom shall I fear?" Then nothing.',
    ],
  ];

  it("strips markdown, bullets and parenthetical references", () => {
    for (const [input, expected] of CASES) expect(speakable(input)).toBe(expected);
  });
});

describe("references, spoken the way a person says them", () => {
  // The transform whose change on 2026-09-04 orphaned the first half of the
  // cache. Pinned hardest.
  const CASES: [string, string][] = [
    ["Psalm 27:1", "Psalm twenty-seven, verse one"],
    ["1 Corinthians 15:9-10", "First Corinthians chapter fifteen, verses nine through ten"],
    ["Matthew 5:23-24", "Matthew chapter five, verses twenty-three through twenty-four"],
    ["Job 38:4-7", "Job chapter thirty-eight, verses four through seven"],
  ];

  it("is unchanged", () => {
    for (const [input, expected] of CASES) expect(speakReference(input)).toBe(expected);
  });

  it("rewrites a reference embedded in prose", () => {
    expect(speakableProse("Sit with Matthew 5:23-24 tonight.")).toBe(
      "Sit with Matthew chapter five, verses twenty-three through twenty-four tonight.",
    );
  });
});
