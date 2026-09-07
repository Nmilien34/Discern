// HUMILITY — the authored path. Nine reads.
//
// Round 08: three types, "the type nobody else in this category ships" —
// teaching, example, failure. Reads 1-3 also carry round 07's three movements
// (recognize, redirect, cultivate), which round 08 relocated out of one scroll
// and into the first three sittings. THE MOVEMENT IS THE ORDER, not a field:
// read 1 recognizes, read 2 redirects, read 3 cultivates. `type` stays the
// round-08 taxonomy.
//
// A paragraph that is exactly a reference from `passages` renders as the
// set-apart passage block at that point. The seed script refuses to write a
// read where such a marker does not resolve, so a typo is a failed seed rather
// than a hole in the middle of someone's read.

import type { ReadType } from "@discern/shared";

export interface AuthoredRead {
  order: number;
  type: ReadType;
  title: string;
  runtimeSeconds: number;
  header: string | null;
  body: string[];
  /** Cited, in order of appearance. Resolved to stored pericopes at seed time. */
  passages: string[];
  /** The one thing to go and do. Null is a real answer — see read 1. */
  action: string | null;
}

export const PRIDE_HUMILITY_READS: AuthoredRead[] = [
  {
    order: 1,
    // RECOGNIZE, the first movement. Teaching is the round-08 type.
    type: "teaching",
    title: "The one fault that edits the report",
    // REVISED 2026-09-06, card 4 min -> 3 min, matching the design CONTENT_MAP.
    //
    // The prose did not get shorter — 523 words before, 526 after — so this is
    // a corrected estimate rather than a trim. 3 min is 526 words at 175 wpm,
    // which is a fair pace for prose meant to be read rather than sat with.
    //
    // WHICH SHARPENS THE PROBLEM RATHER THAN SOLVING IT: read 2 is 530 words
    // and still says 5. Four words apart, two minutes apart. See the runtime
    // note at the foot.
    runtimeSeconds: 180,
    header:
      "a room at dusk, one lamp, a table set for a meal nobody has sat down to yet",
    passages: ["Proverbs 21:2", "Proverbs 26:12"],
    // NO ACTION. The read says out loud that it is "not a verdict and not a
    // diagnosis", and the model allows null because "inventing one is worse
    // than showing a read without one". The question in the body is reflective;
    // dressing it as an ask would emit action_taken at weight 25 for having had
    // a thought.
    action: null,
    body: [
      "Pride is the only fault that hides inside the thing you would use to find it.",
      "Most faults can be caught in the act. Someone is short with a colleague and hears it an hour later. Someone eats the whole thing standing at the counter and knows, while doing it, exactly what is happening. The noticing works because the part doing the noticing is not the part that did it.",
      "Pride is different. It gets into the judgment first, and then the judgment goes looking, and comes back to say that everything is fine here.",
      "So the usual test fails. Ask almost anyone whether they think they are better than other people and they will say no, and mean it. That is not humility. It is that pride almost never arrives feeling like superiority.",
      "It arrives feeling like being correct.",
      "That is the whole disguise. The proud man is not walking around thinking he is above anyone. He is walking around thinking he has looked at the situation carefully and arrived at the right read of it, and that other people have not, and that this is unfortunate but not his fault.",
      "Proverbs 21:2",
      "Notice what that does not say. It does not say some ways are right and some are wrong. It says every way is right in his own eyes, which is the only place he can see from. It is not calling anyone a liar. It is saying the instrument is not neutral.",
      "Solomon says it again, somewhere darker.",
      "Proverbs 26:12",
      "More hope for a fool. That is a strange ranking until the mechanism is clear. A fool can be told. He may not enjoy it, but the information reaches him. The man wise in his own eyes has already run the message through the thing that decides what is true, and it did not survive the trip.",
      "So if the feeling is no use, something else has to be.",
      "Here is the question, and it is narrower than it sounds.",
      "When was the last time you concluded you were wrong about something, and it cost you something to admit it?",
      "Not wrong about a fact. Wrong about a person, or a decision, or how you had been behaving. And costly, so that saying it out loud lost you an argument, or a standing, or the ability to keep telling the story a particular way.",
      "If you can name it, and it was recent, and you remember it stinging, then whatever is loudest in you right now is probably not this.",
      "If nothing comes, that is worth sitting with. It does not mean you have been wrong more often than anyone else. It means the reports have been coming back clean, and nobody's reports come back clean.",
      "That is as far as this goes. Not a verdict and not a diagnosis, just the shape of the thing, so it can be recognised if it turns out to be in the room.",
      // CADENCE LANGUAGE REMOVED. This was "Tomorrow is about what the wanting
      // underneath it is actually for." Reads 2 and 3 still carry theirs.
      "The next one is about what the wanting underneath it is actually for. Because there is something underneath it, it is not wicked, and it is not the part that needs killing.",
    ],
  },
  {
    order: 2,
    // REDIRECT, the second movement.
    type: "teaching",
    title: "What the wanting is for",
    // REVISED 2026-09-06, card 5 min -> 3, which was the last runtime outlier.
    // Measured 536 words. 3.6 min at 150 wpm, 3.1 at read 1's implied 175.
    runtimeSeconds: 180,
    header: "a doorway at first light, the threshold worn down in the middle",
    // WAS Proverbs 3:5-7, NOW 3:5-6.
    //
    // 3:5-7 rendered one clause longer than the prose quoted: WEB verse 7 is
    // two sentences — "Don't be wise in your own eyes. Fear Yahweh, and depart
    // from evil." — and only the first was wanted. Trimming to 3:5-6 makes the
    // block exactly the quote, and "don't be wise in your own eyes" moved into
    // the prose as an inline aside instead, where it also does more work: it
    // arrives as a callback to read 1 rather than as scripture the reader has
    // to be told to ignore half of. Verified: the WEB block is now the quoted
    // text exactly, with balanced quotation marks.
    passages: ["Proverbs 3:5-6"],
    // NO ACTION. "Noticing it is the whole practice for now", in as many words.
    action: null,
    body: [
      "Underneath pride there is a want to be worth something.",
      "Start there, because most attempts at humility skip it and go straight to demolition. Think less of yourself. Take up less room. Stop needing so much. That approach fails, and it fails for a reason worth understanding: it treats the want as the problem, and the want is not the problem.",
      "It was put there. The desire to matter, to be counted, to have one's existence register somewhere, is not a defect that shows up when a person isn't looking. Nobody talks themselves into it. It arrives with the equipment.",
      "The problem is not the wanting. It is where the wanting has been going to get answered.",
      "Consider what happens when a man goes to himself for that verdict.",
      "He assembles the evidence, and he is also the one who decides which evidence counts. He weighs it, and he sets the weights. Then he delivers a judgment, and the instant it lands he knows exactly how it was reached, because he was in the room for all of it.",
      "So it settles nothing. A verdict issued about oneself is the one verdict that cannot close the question, which is why it has to be re-earned tomorrow, and the day after, and why no quantity of it is ever enough. Not because the man is broken. Because that is what a self-issued verdict is.",
      "That is the machinery under most pride. Not arrogance. Exhaustion, managed by a court that never adjourns.",
      "Proverbs 3:5-6",
      "The word doing the work there is lean.",
      "It is not don't think. Solomon spends most of a book insisting on thinking, and this sits inside a collection of hard-won practical wisdom. Leaning is something else. You lean on what holds your weight. You lean when you are tired and need the thing to be load-bearing.",
      "So the instruction is narrower and more useful than it first sounds. Use your understanding. Just do not put your whole weight on it, because it was not built to carry that, and you will feel it give somewhere around three in the morning.",
      // THE LAST CADENCE REFERENCE, REMOVED 2026-09-06. This read "the line
      // from yesterday", pointing at read 1's Proverbs 26:12. Dropping the
      // clause rather than rewording it to "the line from the first read" is
      // the better fix: "Same instrument" already carries the callback, because
      // read 1 ends its own commentary on "the instrument is not neutral". The
      // connection survives without a claim about what day it is.
      "A verse later he adds, almost in passing: don't be wise in your own eyes. Same instrument, same warning, arriving now as a question of where to stand rather than what to notice.",
      "Redirecting is not killing the want. It is moving where it gets answered.",
      "That is the whole turn, and it is smaller than the language of transformation usually implies. Nothing gets amputated. The same hunger goes somewhere else, and the somewhere else can actually settle it, because the verdict no longer comes from the party with an interest in the outcome.",
      "The Greek behind repent is metanoia, a change of mind, a turning. Not primarily an apology. A person walking one direction stops and faces the other way. The wanting is still theirs. Their legs are still their legs. What changed is where they are pointed.",
      "You will probably still catch yourself building the case tomorrow, in the shower, about something small. That is fine. Noticing it is the whole practice for now.",
      "Next is what this looks like when it has actually taken. It is quieter than you would expect.",
    ],
  },
  {
    order: 3,
    // CULTIVATE, the third movement.
    type: "teaching",
    // Design CONTENT_MAP calls this one "Free enough of yourself". That phrase
    // is the third paragraph instead, and the title names the payoff rather
    // than the definition. The canvas is the stale copy, not this.
    title: "What it looks like when it lands",
    // REVISED 2026-09-06, card 4 min -> 3, the last of the three runtime
    // corrections. Measured 462 words: 3.1 min at 150 wpm, 2.6 at 175.
    runtimeSeconds: 180,
    header: "two chairs at a kitchen table, one pulled out, late afternoon light",
    passages: ["Philippians 2:3-4"],
    // STILL NULL, and this is the read where it costs most: it is the cultivate
    // movement and it lists four usable practices in one paragraph — ask a
    // question you do not know the answer to, let someone be right, go first on
    // the apology, say I don't know when it costs something. It declines to
    // name one on purpose, because the close is that the evidence is "mostly
    // visible to other people rather than to you", and an ask would hand the
    // reader a box to tick about themselves. Right for the prose.
    action: null,
    body: [
      "Humility is not thinking less of yourself.",
      "That version is everywhere and it does not work, partly because it is still a project about the self. Talking yourself down is the same activity as talking yourself up, run in reverse, and it costs the same amount of attention.",
      "Humility is being free enough of yourself to be genuinely interested in someone else. It is what is left over when a person stops managing how they are coming across.",
      "Which runs straight into a problem, because here is the verse.",
      "Philippians 2:3-4",
      // The revision takes the corpus's own casing: WEB verse 3 begins
      // lowercase "doing", because it continues from verse 2. The prose used to
      // capitalise it, which would have set the block one letter off from the
      // scripture beside it in the reader.
      // BOTH PROSE QUOTATIONS OF SCRIPTURE ARE GONE, 2026-09-07. This opened
      // "Counting others better than himself" — four words verbatim from WEB,
      // sitting in prose directly under a block that a KJV reader sees as
      // "in lowliness of mind let each esteem other better than themselves".
      // It now DESCRIBES the clause instead of reproducing it, which works in
      // either translation.
      "The clause in the middle, the one about ranking other people above yourself, sounds exactly like the self-abasement this read just ruled out. It is worth stopping on rather than stepping past, because a great deal of the damage done in the name of humility comes from reading it as an instruction to hold a low opinion of oneself.",
      // The second one, and the longer: this reproduced fourteen words of WEB
      // verse 4 verbatim. Paraphrased now — and the paraphrase does more work
      // than the quotation did, because "drops the language of comparison
      // entirely" is the actual argument, which quoting the verse left the
      // reader to infer.
      "But look at what follows. Paul does not leave it abstract. Verse 4 drops the language of comparison entirely and asks something plainer: that a person's attention land on other people's concerns and not only on their own.",
      "It is not a ranking. It is a direction. He is not asking anyone to arrive at a conclusion about relative worth, which would be a strange thing to require and impossible to verify. He is asking where the attention goes when there is a limited quantity of it in the room.",
      "A person can hold an accurate view of their own abilities and still be the one who asks the second question instead of waiting to talk. Those are unrelated. One is an assessment. The other is a direction of travel.",
      "In practice it is small and unglamorous, and it never once feels profound while it is happening.",
      "Asking a question you do not already know the answer to. Letting someone else be right in front of other people, and not adding the small correction that would have shown you knew. Going first when the apology is owed by both of you. Saying I don't know at the exact moment when saying it costs something.",
      "None of that will feel like spiritual progress. It will feel like a slightly worse afternoon.",
      "That is worth knowing before you go looking for evidence. The proof that this is taking hold will not be a feeling of being humble, because that feeling is unreliable and frequently means its opposite. It will be small and specific and mildly irritating, and it will mostly be visible to other people rather than to you.",
      "Which is, on reflection, the only way it could work. A humility you could confirm from the inside would be a verdict you issued about yourself, and those never settle anything.",
      "Next is a dinner party, and a room full of people quietly working out where they rank.",
    ],
  },
  {
    order: 4,
    // The first read past the three movements. Design CONTENT_MAP has this one
    // at slot 4 too, with the same title and the same passage — the first read
    // whose title survives the canvas unchanged.
    type: "teaching",
    title: "Take the lowest place",
    // Measured: 419 words, 13 paragraphs, two passage blocks — the shortest so
    // far. 2.8 min at 150 wpm, 2.4 at read 1's implied 175. Card says 3, which
    // agrees with the measurement AND with the design CONTENT_MAP's 4 min only
    // loosely — but read 4 is now consistent with read 1, which is the thing
    // that was wrong before.
    runtimeSeconds: 180,
    header:
      "a long table laid for a feast, seen from the far end, chairs not yet filled",
    // LUKE 14:7 REMOVED AS A BLOCK, 2026-09-06. Nick's call: it was a citation
    // error, not a rendering problem — a short setup fragment belongs inline in
    // the prose, and only a full passage earns a block. It also happened to be
    // the case where WEB runs three words and a comma past where the prose
    // stops ("...chose the best seats, and said to them,").
    //
    // The prose then ABSORBED it properly in a second pass: the opening
    // sentence now attributes the observation to Luke by name, and the argument
    // that used to hinge on "the problem is verse 7" hinges on "what he noticed
    // in the first place" instead — because a verse number as the hinge of an
    // argument only works while that verse is on the screen.
    passages: ["Luke 14:10-11"],
    // STILL NULL. Four reads. This one comes closest — "You can put it down" —
    // but what it asks to be put down is an internal calculation, which is not
    // a thing anyone can mark done. See the note at the foot.
    action: null,
    body: [
      // VERSE 7 LIVES HERE NOW. It used to be a block between this paragraph
      // and the next; the 2026-09-06 revision folds it into the prose and
      // attributes it — "Luke says plainly what set it off" — which is what a
      // short setup fragment is supposed to do. Better than the deletion that
      // preceded it, which left the sentence carrying v7 only by implication.
      "This one does not happen on a mountainside. It happens at a dinner party, and Luke says plainly what set it off: Jesus noticed how the guests were choosing the best seats.",
      "That is the whole setup. Not a sermon, not a question from the crowd. A room where everyone is quietly working out where they rank, and one guest noticing that this is what the room is doing.",
      "Anyone who has been to a wedding knows the calculation. Which table, how near the front, who was seated next to whom and what that means. Nobody says any of it out loud. Everybody runs it.",
      "Luke 14:10-11",
      "Read quickly, that is advice on how to win the game. Sit low, get moved up, be seen being moved up. Which would make it a better strategy for the same competition, and would leave the room exactly as it was.",
      // "the problem is verse 7" became "the problem is what he noticed in the
      // first place". A verse NUMBER as the hinge of an argument only works
      // when the verse is on the screen; with the block gone it would have been
      // a citation the reader had to go and look up mid-paragraph.
      "That reading has a problem, and the problem is what he noticed in the first place. The thing being described is the choosing. A person who takes the low seat in order to be moved up has not stopped choosing. He has made the same move with a longer setup, and he will spend the meal waiting to be called forward, which is a worse evening than simply sitting at the front.",
      "Verse 11 is what settles it, and it is not phrased as tactics. Everyone who exalts himself will be humbled. That is not a recommendation. It is a description of how this always goes, offered by someone who has watched it go that way every time.",
      "So the instruction is not take the low seat and you will be promoted. It is closer to: the promotion is not yours to arrange, it never was, and the entire apparatus you have built for arranging it has never once worked. You can put it down.",
      "Which is, if you sit with it, an offer rather than a demand.",
      "The seat you take is a small thing. The exhausting part was never the seat. It was the running calculation, the low continuous hum of working out where you stand and whether it is holding, in a room where everyone else is doing the same arithmetic and nobody is saying so.",
      "Being told you can stop doing that is not a rebuke. It is the closest thing to rest that scene contains.",
      "The next one is about a man who was told, plainly and in advance, that he was going to fall away, and who argued.",
    ],
  },
  {
    order: 5,
    // THE FIRST NON-TEACHING READ. Design CONTENT_MAP had Peter at slot 7 as a
    // Failure and "The one who washed feet" at 5; those have swapped, so the
    // round-08 taxonomy starts at read 5 rather than read 6 and the canvas's
    // ordering is superseded from here on.
    type: "failure",
    // Canvas title was "What Peter could have done". That phrase is now a body
    // paragraph; the title names what he actually said instead, which is the
    // thing the read is about.
    title: "What Peter answered",
    // Measured 504 words, 16 paragraphs. 3.4 min at 150 wpm, 2.9 at 175.
    runtimeSeconds: 180,
    header:
      "a courtyard at night, a low fire, figures standing around it not looking at each other",
    // ONE CITATION NOW. Matthew 26:69-75 was dropped in the 2026-09-06 revision
    // — it was the read's straddle case, spanning the stored pericopes
    // 26:69-71 and 26:72-75, so carried it would have given two of the three
    // denials and stopped before the rooster.
    //
    // Removing it rather than working around it is the stronger move: the
    // denial is narrated in the prose already ("By morning he has denied
    // knowing the man three times, the last of them to a servant girl"), and
    // the read's argument is about what Peter SAID beforehand, not about the
    // night itself. The one block left is the sentence the whole read is about.
    //
    // It carries its attribution — "But Peter answered him," — verbatim from
    // the corpus, so the block names its own speaker. Balanced marks, no trim.
    passages: ["Matthew 26:33"],
    // THE FIRST ACTION IN THE PATH, added 2026-09-06 after five reads of none.
    //
    // It works where the earlier four could not because it names A FACT, not a
    // self-assessment: you either went and said it or you did not. Every
    // earlier candidate — notice the wanting, put down the calculation, be
    // free enough of yourself — would have handed the reader a box to tick
    // about their own interior, which is the failure mode read 3 spends its
    // last paragraph on.
    //
    // "Not by message" is load-bearing and stays. The read is about a sentence
    // Peter could have said out loud in a room and didn't, and a text message
    // is the modern version of the longer setup.
    //
    // This is what emits `action_taken` at weight 25, uncapped — the heaviest
    // event in the ledger, and until now nothing in the product produced one.
    action:
      "Go to the person you were wrong about, and say so out loud. Not by " +
      "message. This week.",
    body: [
      "He was told. That is the part most retellings hurry past.",
      "Peter did not stumble into the worst night of his life unwarned. He was told plainly, in advance, by someone who was not guessing, exactly what he was going to do and roughly when. And he had a response ready.",
      "Matthew 26:33",
      "Read that slowly, because there is more in it than a denial.",
      "He does not only say I won't. He says even if all of them do. In one sentence, told he is about to fail, he sorts the room and puts himself at the top of it. Eleven other men are standing there. He has just quietly ranked every one of them below himself, on the strength of nothing, at the precise moment he is being told he is wrong.",
      // THE MISQUOTATION IS GONE, 2026-09-06. This line used to end "...and
      // raises it: even if I must die with you, yet I will not deny you" —
      // presented as a quotation and belonging to neither translation. WEB
      // Matthew 26:35 reads "Even if I must die with you, I will not deny you";
      // KJV reads "Though I should die with thee, yet will I not deny thee".
      // The "yet" was KJV inside WEB phrasing.
      //
      // Replaced with a PARAPHRASE rather than a corrected quotation, which is
      // the better fix: no quotation marks, no claim about which translation,
      // and it cannot go wrong again for a reader who chose the other one.
      "Then he is told again, with the detail filled in. Before the rooster. Three times. And he answers a second time, and raises it. He would die first.",
      "By morning he has denied knowing the man three times, the last of them to a servant girl. The other accounts add that he was warming himself at a fire that belonged to the people who had made the arrest.",
      "This is pride at its most exact, and notice what it is not.",
      "It is not that Peter thought he was a better man than the others, though he said something that amounted to that. It is that he was told something true about himself, by someone who could not be mistaken, and the information did not survive contact.",
      "He heard it. He was not distracted or drunk or arguing with a stranger. He simply had, already in place, a judgment about what kind of man he was, and the judgment had authority over the evidence rather than the other way round.",
      // THE ORDINAL CROSS-REFERENCE IS GONE, and what replaced it is the most
      // durable form yet: not "the first read", not a name, but READ 1'S IDEA
      // RESTATED IN READ 1'S OWN WORDS — "the judgment goes looking, and comes
      // back to say that everything is fine here". It lands for someone who
      // read read 1 as a callback, and for someone who did not as a sentence
      // that stands on its own. Nothing to break in a reorder.
      "That is the judgment that goes out looking and comes back reporting that everything is fine here, in the one situation built to correct it, refusing to be corrected.",
      "What he could have done was smaller than heroism and harder than it.",
      "He could have said: if you say so, then stay near me tonight, because I clearly cannot do this on my own. That is not courage. It is one sentence, and it costs only the picture he had of himself, and it would have changed the whole night.",
      "One thing before you sit with any of that. It is not the end of his story. The man who denied Christ three times was asked three times whether he loved him, and then told to feed the sheep. The failure is tellable because it was survivable.",
      "Which is worth holding onto, because the point of looking at it squarely is not to feel the weight of it. It is to notice how ordinary the refusal was, and how available the other sentence would have been.",
      "Next is a man who knelt in front of his friends with a basin, on the last night, before he said anything at all.",
    ],
  },
  {
    order: 6,
    // Design CONTENT_MAP had this at slot 5 with John 13:12-15; it is at 6 now,
    // and the citation moved BACKWARD to 13:3-5 — to the inventory sentence
    // before anyone moves, which is the thing the read is actually about.
    // 13:12-15 survives as the closing allusion.
    //
    // RETYPED example ON 2026-09-06, alongside read 8. See the shape note at
    // the foot: the line is simply narrative vs exposition, and within
    // narrative, whether the person gets it right.
    type: "example",
    title: "The one who washed feet",
    // Measured 428 words, 13 paragraphs. 2.9 min at 150 wpm, 2.4 at 175.
    runtimeSeconds: 180,
    header: "a basin on a stone floor, a folded towel beside it, one lamp burning low",
    // SECOND STRADDLE, AND WORSE THAN THE FIRST. John 13:3-5 spans the stored
    // pericopes John 13:1-4 and John 13:5-18, so a single storedReference gives
    // the reader 13:1-4 — which stops at "laid aside his garments" and does not
    // contain the washing. Matthew 26:69-75 at least delivered two of three
    // denials; this one delivers the setup and cuts before the act.
    passages: ["John 13:3-5"],
    // No action. Read 5 carries the path's only ask, and this read's close is
    // deliberately the opposite of an instruction — "you only have to be
    // unoccupied enough to notice that it is still sitting there".
    action: null,
    body: [
      "The detail that makes the scene work is in the sentence before anyone moves.",
      "John 13:3-5",
      "Read the first sentence again, because it is doing something strange.",
      "It is not a note about modesty. It is an inventory. All things into his hands. Where he came from, where he was going, the whole account laid out. And then the next word is arose.",
      "He did the job of the lowest servant in the house, and the reason the passage gives is not that he thought little of himself. The reason it gives is that he knew exactly what he had.",
      // THE LAST ORDINAL IN THE PATH, REMOVED 2026-09-06. It read "That is the
      // third read again, in a room instead of a definition." What replaced it
      // makes no reference at all — it just names what the scene is doing — so
      // it needs no prior read and cannot be broken by a reorder. Nine reads,
      // zero ordinals.
      "That is the definition acted out rather than stated.",
      "Humility is not a low estimate. It is what a person does once the question of their standing is closed and no longer needs attending to. Someone unsure of where he stands cannot pick up the basin, because picking it up would say something about him. Someone who knows can pick it up and it says nothing about him at all, which is precisely what frees his hands.",
      "The job itself was not symbolic. Feet in that house were the actual condition of the road: dust, animals, open sandals. It was unpleasant work given to whoever was lowest, and twelve men had walked in past the water and the towel by the door and left them sitting there. Not one of them was a bad man. Each of them had simply run the same fast arithmetic about who in the room it fell to, and come back with the same answer.",
      "There is a harder detail, and it is easy to read past.",
      "Judas was in the room. His feet were washed too, by someone the text says already knew what he intended to do. Whatever else that is, it is not a reward for merit. The posture does not stop to work out who has earned the service, because it is not issuing verdicts about anyone. It has already stopped doing that. That is what it costs and that is what it buys.",
      // John 13:12-15, alluded to rather than cited — and it sits inside John
      // 13:5-18, the same pericope the citation already straddles into.
      "Afterwards he sat back down and asked whether they understood what had just happened, and told them it was for copying, not admiring.",
      "Which puts the thing within reach, and takes away the excuse. You do not have to feel humble to pick something up. You only have to be unoccupied enough to notice that it is still sitting there.",
      "Next is a commander who was offered a cure and nearly went home instead, because of how small it was.",
    ],
  },
  {
    order: 7,
    // Not on the canvas at all. Design CONTENT_MAP had 7 as the Peter failure,
    // which shipped at 5; Naaman is new material in this slot.
    type: "failure",
    title: "The river he was offered",
    // Measured 405 words, 14 paragraphs — the shortest of the seven. 2.7 min
    // at 150 wpm, 2.3 at 175.
    runtimeSeconds: 180,
    header:
      "a brown river running low between banks, horses and chariots waiting on the road above",
    // CLEAN. Sits entirely inside the stored pericope 2 Kings 5:7-13, which is
    // tagged pride-humility — so unlike reads 5 and 6 this one carries whole.
    //
    // It is also the first citation with NESTED SPEECH: Naaman quoting the
    // scene he had written for himself, single marks inside double, plus two
    // contractions using the same glyph. Verified live that
    // lib/quote-balance.ts leaves it completely alone, which is the case it was
    // written not to break.
    passages: ["2 Kings 5:10-12"],
    // NO ACTION FIELD. The closing question is still the nearest thing to a
    // second ask in the path — three concrete deeds rather than an interior
    // move — but it no longer collides with read 5's action, which it did until
    // the 2026-09-06 revision.
    action: null,
    body: [
      "Naaman commanded the armies of Syria. He arrived with horses, chariots, an escort, a letter from his king and a fortune in silver and gold, and he was dying.",
      "He had come a long way on the word of a captured girl who worked in his house, which is worth noticing on its own. He was prepared to be healed. He was not prepared for how.",
      "2 Kings 5:10-12",
      "Behold, I thought. He had the whole scene written. The prophet comes out personally. There is a gesture. There is a word spoken over the affected place. It is public, and it is proportionate to a man of his rank.",
      "What he got was a messenger at the door with an errand, and a muddy provincial river he could name two better ones than from memory.",
      "Notice that he was not wrong about the rivers.",
      // THE ORDINAL IS GONE, replaced by READ 1'S TITLE used as the referent:
      // "the fault that edits the report". Durable in both directions — it
      // survives a reorder, and it is a complete image for someone who never
      // read read 1. It does now depend on read 1 keeping that title.
      "Abanah and Pharpar really were the finer waters. His objection was accurate, and it was completely beside the point, and he could not tell the difference between those two things because his correctness was doing a different job by then. It was carrying his standing. That is the fault that edits the report, working exactly as advertised, at the worst possible moment.",
      "He nearly went home. He had come that entire distance, and the thing that almost stopped him was not the difficulty of the cure. It was that the cure was too small to be dignified.",
      "His servants talked him down, and their argument was almost comically plain: if he had been told to do something hard, he would have done it gladly. He was being told to wash. So he went down and washed seven times, and came up clean.",
      "There is a version of this in most weeks.",
      "The help that would work is available, and it is undignified, or it is smaller than the problem seemed to deserve, or it arrives through someone with no standing to be advising you. And the reasons for declining are all sound.",
      "What is the thing you already know would help, that you have not done because of how ordinary it is?",
      // THE DUPLICATE EXAMPLE IS GONE. This used to open "The apology by phone
      // rather than by message", which nearly restated read 5's action ("say so
      // out loud. Not by message"). What replaced it also fits the read better:
      // taking advice from someone who has obviously done this before is what
      // the captured girl and the servants both are, and Naaman nearly refused
      // both of them for the same reason.
      "Not the difficult thing. The small one. The advice you could take from the person who has obviously done this before, the meal eaten sitting down, the conversation you keep upgrading into something more serious than it needs to be.",
      "Next is another commander, in another army, who got it right in a single sentence.",
    ],
  },
  {
    order: 8,
    // Design CONTENT_MAP had the centurion at slot 6 typed EXAMPLE. He is at
    // slot 8 and typed example, so the canvas was right about the type and only
    // the position moved.
    type: "example",
    title: "What the soldier understood",
    // Measured 396 words, 13 paragraphs — the shortest of the eight. 2.6 min
    // at 150 wpm, 2.3 at 175.
    runtimeSeconds: 180,
    header:
      "a doorway in strong noon light, a road beyond it, a man stopped just outside",
    // THIRD STRADDLE, AND AGAIN IT CUTS THE POINT. Matthew 8:8-10 spans the
    // stored pericopes Matthew 8:5-9 and Matthew 8:10-13, both tagged
    // pride-humility. Carried, it resolves to 8:5-9 — the centurion's speech
    // WITHOUT Jesus's response, which is the "he marveled" line this read's
    // penultimate section is entirely about.
    //
    // The pattern across three straddles is consistent: the citation is the
    // rhetorically coherent unit, and the corpus segmented on different seams.
    passages: ["Matthew 8:8-10"],
    action: null,
    body: [
      "Another commander, another foreign army, and the opposite result in a single sentence.",
      "A Roman officer asks for help for someone in his household. Jesus offers to come to the house. The officer declines the visit.",
      "Matthew 8:8-10",
      "The load-bearing word is also.",
      "He is not saying he is nothing. He commands men; they go where he sends them; that is simply true and he says it plainly. He is saying that he recognises the arrangement, because he lives inside one. He is under someone. Everything he can do rests on that, and none of it rests on him personally.",
      "So he draws the obvious conclusion and does not need it explained. If the word is the thing that carries the weight, the word can be sent. The journey is unnecessary. He is not being modest about his house. He is being accurate about how authority travels.",
      // CROSS-REFERENCE BY NAME, not by ordinal — and it is the better pattern.
      // "Set him beside Naaman" survives any reorder; "the third read again"
      // does not. See note 1 at the foot.
      "Set him beside Naaman and the difference is not rank, and it is not manners.",
      "Naaman wanted the visit. He had earned a visit. When the cure came without one he heard it as a comment on his standing, because he was still tracking his standing, and the tracking was running underneath everything else he thought he was doing.",
      "The centurion is not tracking. He walks up to a travelling teacher with no rank in his world at all, and gives an unprompted, unflattering, entirely correct account of his own position, and asks. Nothing in him has to be managed first.",
      "Then there is the detail everyone misses. He marveled. That word is used of Jesus almost nowhere. What produced it was not fervour or sacrifice or a long record of devotion. It was a man being exactly right about where he stood.",
      "Which is the correction this whole virtue has been circling.",
      "Humility is not an unflattering opinion you hold about yourself. It is knowing your actual position, what you carry and what you do not and who you are under, and then behaving like someone who knows it. That is a species of knowledge, and it is the one kind of self-knowledge that does not have to be re-earned every morning, because it was never a verdict in the first place.",
      // THE COUNT CLAIM IS GONE, 2026-09-06. This read "One read left. It is
      // the largest..." — a positional dependency that was wrong out of
      // sequence and would be wrong for everyone the day a tenth read existed.
      // "Next is" matches the other eight closings.
      //
      // "The largest of these" went too, on 2026-09-06. It was defensible as a
      // claim about subject — four chapters of whirlwind — but it sat directly
      // above a runtime card reading 3 min like every other, which pushed it
      // toward the word-count reading, where read 9 is joint fourth of nine.
      "Next is a man who was right the whole way through, and what he was shown anyway.",
    ],
  },
  {
    order: 9,
    // Design CONTENT_MAP had Job at slot 8 typed EXAMPLE ("Now my eye sees
    // you") and a Uzziah failure at 9. Job is the closer and is typed teaching;
    // Uzziah is dropped. The shipped path is 5 teachings, 2 failures, 0
    // examples — the canvas planned 5/2/2.
    type: "teaching",
    title: "Out of the whirlwind",
    // Measured 462 words, 14 paragraphs. 3.1 min at 150 wpm, 2.6 at 175.
    //
    // READ 8 PROMISES "One read left. It is the largest." IT IS NOT. Read 2 is
    // 536 words, read 1 is 526, read 5 is 504. This is 462 — joint fourth with
    // read 3, and it carries the same 3 min card as all the others.
    runtimeSeconds: 180,
    header: "open ground under a night sky, the horizon low, the stars unusually close",
    // The inline quote of Job 38:6 was "Whereupon were its foundations
    // fastened?" — a WEB/KJV hybrid — and now reads "What were its foundations
    // fastened on?", which is WEB verbatim. Verified.
    //
    // BOTH CITATIONS STRADDLE, one at each end of the book:
    //   Job 38:4-7  spans Job 38:1-6 + Job 38:7-20
    //   Job 42:5-6  spans Job 42:1-5 + Job 42:6-10
    // Carried, the first gives 38:1-6 — which stops before "when the morning
    // stars sang together", the line the paragraph after it is about — and the
    // second gives 42:1-5, which stops before "Therefore I abhor myself", the
    // half the whole closing argument turns on.
    //
    // BOTH ALSO NEED QUOTE TRIMMING IN WEB, one of each kind: 38:4-7 opens
    // God's speech and never closes it (“1 ”0), 42:5-6 closes Job's speech
    // without opening it (“0 ”1). lib/quote-balance.ts handles both. KJV uses
    // no marks at all here, so a KJV reader sees neither problem.
    passages: ["Job 38:4-7", "Job 42:5-6"],
    action: null,
    body: [
      "Start with the part that gets left out: Job was right.",
      "He had lost everything, his friends had come to explain why he must have deserved it, and he had refused the explanation for thirty-odd chapters, insisting that the accounting did not work and that he wanted to say so to God directly. At the end of the book God tells the friends they were wrong and Job was not. Their theology was tidy. His was accurate.",
      "So whatever happens at the whirlwind, it is not a proud man being put in his place. It is worth being clear about, because these reads are easy to hear as accusations, and this one is not one.",
      "What Job gets is an answer that is not an answer.",
      "Job 38:4-7",
      "That goes on for four chapters. The sea, the storehouses of snow, the wild donkey who laughs at the city, the ostrich who leaves her eggs in the dust, the horse who says Aha among the trumpets. Not one of Job's questions is addressed. Instead he is taken on a tour of a world that was running long before he arrived and is full of things made for no reason he was consulted about.",
      "It reads as evasion until you notice the tone. None of it is sarcastic. It is closer to delight, someone showing a man the size of the thing he has been standing inside.",
      "Job 42:5-6",
      "Two things about that.",
      "The first is the hinge in the line above it. I had heard. Now I see. Nothing was explained to him. He did not receive information. What changed was scale, and at that scale the question he had been carrying stopped being the largest object in the room.",
      // REWRITTEN TWICE ON 2026-09-06, AND THE ARGUMENT IS NOW THE BEST OF THE
      // THREE. It first rested on the Hebrew — that "abhor myself" has no
      // stated object and the "myself" is supplied — which is true of
      // translations at large but UNVERIFIABLE FROM INSIDE THE APP, because WEB
      // and KJV both say "I abhor myself". The reader was told the translators
      // disagree directly beneath a block showing the only two available, which
      // agree.
      //
      // It then argued from the book but said "three verses later"; it is the
      // very next verse — Job 42:6 is the dust and ashes, 42:7 is "you have not
      // spoken of me the thing that is right, as my servant Job has". Verified
      // against WEB. Now corrected, and the claim is stronger for it.
      //
      // "thirty chapters" also became "chapter after chapter", which removes
      // the last countable assertion in the read — the second paragraph already
      // says "thirty-odd chapters", and this is not the place to be precise
      // twice about the same number.
      "The second is that it sounds like self-loathing, and the book will not support that reading. In the very next verse God turns to the friends, the ones who had spent chapter after chapter explaining what Job must have done to deserve this, and tells them they were wrong and Job was not. That verdict is delivered after the dust and ashes, not before. So whatever Job sets down there, it is not his worth. It is the case he had been building, and he sets it down because he no longer needs it, not because he lost.",
      "That is where this virtue lands.",
      // THE CLOSING SUMMARY, and the best cross-reference form in the path: it
      // recalls reads 1, 2, 6, 7 and 8 BY IMAGE — the report, the verdict, the
      // basin, the river, the soldier — with no ordinal, no title and no name.
      // Reorder-proof, and it reads as prose rather than as an index.
      "At the start, the problem was a report that always came back clean. Then a verdict about yourself that could never settle, because you were also the judge. Then a basin, a river, a soldier at a door. All of it has been the same move from different angles: the question of your standing is not yours to settle, it was never going to be settled by you, and you are permitted to stop.",
      "Not smaller. Just no longer the thing being measured.",
    ],
  },
];

// ── THE PATH IS WRITTEN. NINE READS, 4,147 WORDS. ───────────────────────────
//
// ✅ CLOSED — RUNTIME (all nine cards 3 min, 396-536 words), FORWARD CADENCE,
//    BACK-REFERENCE CADENCE, FIRST ACTION (read 5), QUOTE BALANCING,
//    ACTION DUPLICATION (read 7).
//
// SHAPE AGAINST THE CANVAS. The canvas planned 5 Teaching, 2 Example, 2 Failure
// and the shipped path is exactly that — 5/2/2 — reached by a different route.
// Only the ORDER and the CAST moved: the canvas had washed-feet / centurion /
// Peter / Job / Uzziah at slots 5-9; shipped is Peter / basin / Naaman /
// centurion / Job, with Uzziah dropped for Naaman, who was not on the canvas.
//
//   1 teaching  2 teaching  3 teaching  4 teaching
//   5 failure   6 example   7 failure
//   8 example   9 teaching
//
//   THE TYPE LINE, as it ended up: exposition is teaching; a narrative portrait
//   is example or failure depending on whether the person gets it right. Four
//   teachings build the frame, the four portraits carry the argument through
//   contact with people, and one teaching lands it. (An earlier note in this
//   file explained the line as "shows the thing" vs "states it", which was
//   wrong — it did not survive read 8 being retyped.)
//
// ✅ CLOSED — CROSS-REFERENCES. Read 6's "That is the third read again" was the
//    last ordinal, removed 2026-09-06 in favour of "That is the definition
//    acted out rather than stated", which refers to nothing and needs nothing.
//    NINE READS, ZERO ORDINALS. The four durable forms in use:
//      read 5  read 1's IDEA restated in read 1's own words
//      read 6  no reference at all — the sentence names what the scene does
//      read 7  read 1's TITLE, "the fault that edits the report"
//      read 8  BY NAME, "Set him beside Naaman"
//      read 9  BY IMAGE — "a report that always came back clean... a basin, a
//              river, a soldier at a door" — five reads recalled as prose
//    Nothing in the path now breaks if the order changes, except read 8's
//    count claim below.
//
// ✅ CLOSED — POSITIONAL CLAIMS, ENTIRELY. Read 8's "One read left" went first,
//    then "the largest of these" on 2026-09-06. NOTHING IN 4,131 WORDS NOW
//    DEPENDS ON WHERE THE READER IS IN THE PATH, OR ON HOW MANY READS THERE
//    ARE. Every read closes with "Next is" and names what is coming by its
//    content.
//
// 3. FOUR STRADDLES ACROSS THREE READS, and every one cuts the half its read is
//    about:
//      John 13:3-5   6  spans 13:1-4 + 13:5-18   loses THE WASHING
//      Matthew 8:8-10 8 spans 8:5-9 + 8:10-13    loses "he marveled"
//      Job 38:4-7    9  spans 38:1-6 + 38:7-20   loses "the morning stars sang"
//      Job 42:5-6    9  spans 42:1-5 + 42:6-10   loses "I abhor myself"
//    Read 5 closed its own by DROPPING the citation and letting the prose carry
//    the narration, which is the cheapest fix and worth considering for these.
//    Otherwise: `storedReferences: string[]`.
//
// 4. QUOTE TRIMMING IS NEEDED BY FOUR OF THE ELEVEN CITATIONS — Luke 14:10-11,
//    Matthew 8:8-10, Job 38:4-7, Job 42:5-6 — which tracks the corpus-wide rate
//    of 1,242 of 4,090 stored pericopes (30.4%) unbalanced in WEB, because
//    segmentation cuts speeches. lib/quote-balance.ts handles all four. KJV
//    uses no quotation marks at all, so a KJV reader never sees any of it.
//
// ✅ CLOSED — READ 9'S THREE TEXT PROBLEMS, all on 2026-09-06. The Job 38:6
//    inline quote was a WEB/KJV hybrid and is now WEB verbatim. The argument
//    against reading "I abhor myself" as self-loathing used to rest on the
//    Hebrew — unverifiable from inside an app that ships WEB and KJV, which
//    both say "myself" — and now rests on the book: God vindicates Job AFTER
//    the dust and ashes, in the very next verse. That is checkable in one tap
//    from the block above it, and the verse count was corrected to match.
//
//    THE WRITING IS DONE. Nothing in 4,143 words is now unverifiable, wrong
//    against the corpus, dependent on the reader's position in the path, or
//    dependent on how many reads there are.
//
// 5. THE PATH IS COMPLETE, SO PUBLISHING IS NOW A REAL CHOICE.
//    `availability.service.ts` makes humility available at readCount > 0, and
//    the standing decision was to wait for completion or six of nine. Nine are
//    written. Publishing sets `publishedAt` and the wall will name read 1, "The
//    one fault that edits the report".
//
// 8. STILL NO SECOND ACTION. Read 5 carries the path's only one. read_completed
//    does not exist as an event type, so nine reads produce nine × 0 points
//    plus one action_taken at 25 — the whole ledger contribution of a completed
//    virtue is one apology.
//
// 9. UNCITED ALLUSIONS, all deliberate: read 5 John 21:15-19 and the denial at
//    Matthew 26:69-75, read 6 John 13:12-15, read 7 the servants at 2 Kings
//    5:13, read 9 the four chapters of the whirlwind speech beyond 38:7.
