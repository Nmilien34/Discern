// The art, addressed by the same keys the API uses.
//
// AUTHOR_PORTRAITS is keyed by the `slug` on GET /v1/bible/authors, so a screen
// that has an author from the API can reach its portrait without a second
// lookup table and without a naming convention that drifts. Twenty-nine of the
// thirty-nine slugs have a portrait; the rest are the anonymous ones — the
// author of Judges, the author of Ruth, the Chronicler — and there is nothing
// to paint for a person nobody can name. `portraitFor()` returns null for
// those, which is a state the UI has to handle rather than a bug.
//
// FILENAMES ARE NOT NORMALISED ON DISK. Jhon, Joanh, Nehmiah, salomon and
// "Judah Iscariot" are all spelled the way they arrived. The mapping is done
// here, once, rather than by renaming files that may be regenerated later
// under the same names.
//
// SIZE. These are 1086×1448 PNGs at roughly 2 MB each — about 108 MB for the
// set, which is far more than an app bundle should carry. Before ship they
// want to be JPEG or WebP at the size they are actually drawn (a 84pt bubble
// at 3× is 252px), or moved behind the same S3 the passage audio uses. See
// the note at the foot of this file.

/** Author portraits, keyed by the slug returned by GET /v1/bible/authors. */
export const AUTHOR_PORTRAITS: Readonly<Record<string, number>> = {
  moses: require("./men/moses.png"),
  joshua: require("./men/joshua.png"),
  ezra: require("./men/ezra.png"),
  nehemiah: require("./men/Nehmiah.png"),
  david: require("./men/david.png"),
  solomon: require("./men/Solomon.png"),
  isaiah: require("./men/Isaiah.png"),
  jeremiah: require("./men/Jeremiah.png"),
  ezekiel: require("./men/Ezekiel.png"),
  daniel: require("./men/Daniel.png"),
  hosea: require("./men/Hosea.png"),
  joel: require("./men/Joel.png"),
  amos: require("./men/Amos.png"),
  obadiah: require("./men/Obadiah.png"),
  jonah: require("./men/Joanh.png"),
  micah: require("./men/Micah.png"),
  nahum: require("./men/Nahum.png"),
  habakkuk: require("./men/Habakkuk.png"),
  zephaniah: require("./men/Zephaniah.png"),
  haggai: require("./men/Haggai.png"),
  zechariah: require("./men/Zechariah.png"),
  malachi: require("./men/Malachi.png"),
  matthew: require("./men/Matthew.png"),
  mark: require("./men/Mark.png"),
  luke: require("./men/Luke.png"),
  john: require("./men/Jhon.png"),
  paul: require("./men/paul.png"),
  peter: require("./men/Peter.png"),
  // `author-of-samuel` is anonymous in the API; the portrait is of Samuel the
  // person, who is in the book rather than behind it. Kept under his own key
  // so nothing mistakes it for an attribution.
  samuel: require("./men/Samuel.png"),
};

/**
 * The twelve. Not authors — three of them wrote and the other nine are people
 * in the story — so they are a separate set rather than entries in the one
 * above. There is no API for these yet.
 */
export const DISCIPLE_PORTRAITS = {
  peter: require("./TheDisciples/Peter.png"),
  andrew: require("./TheDisciples/Andrew.png"),
  jamesZebedee: require("./TheDisciples/James(Zebedee).png"),
  john: require("./TheDisciples/John.png"),
  philip: require("./TheDisciples/Philip.png"),
  bartholomew: require("./TheDisciples/Bartholomew.png"),
  matthew: require("./TheDisciples/Matthew.png"),
  thomas: require("./TheDisciples/Thomas.png"),
  jamesAlphaeus: require("./TheDisciples/James.png"),
  jude: require("./TheDisciples/Jude(Thaddaeus).png"),
  simon: require("./TheDisciples/SimonTheZealot.png"),
  // Spelled "Judah Iscariot" on disk. He is Judas everywhere in the text.
  judas: require("./TheDisciples/Judah Iscariot.png"),
} as const;

/** Hers. One image, used at three sizes — see the portrait component. */
export const ABIGAIL_PORTRAIT: number = require("./abighail.png");

/**
 * Scenes, not people. Named by what they DEPICT rather than by where they are
 * used, so a screen can be redesigned without the asset name going stale.
 */
export const SCENES = {
  /** A lit doorway at the top of stone steps, at night. */
  doorwayAtNight: require("./townsandviews/cab671a9-9f0c-43c9-80cb-986c10ceae47.png"),
  /** A village lane running out of frame at sunset. */
  laneAtDusk: require("./townsandviews/16ab2119-c7ec-4612-a5d3-00d83bc3e70c.png"),
  /** A stone basin, a folded cloth, a pair of sandals. */
  basinAndCloth: require("./townsandviews/650182bd-d34f-423e-aefd-a2e70a8af26f.png"),
  /** Moonlight on the water, a boat, one lamp burning on the shore. */
  shoreAtNight: require("./townsandviews/7ddf9633-b217-4619-98a8-827f1d1b726f.png"),
  /** Two coins on a worn table, bread and a jar beside them. */
  coinsOnATable: require("./townsandviews/a14e8f01-814d-4371-ba1c-64c61172d952.png"),
  /** A man writing by lamplight in a cell, a chain on the wall. */
  writingInChains: require("./men/7e3cde7c-249a-4a3b-9c4e-638c4ff7cecd.png"),
  /** A man with his head in his hands by a fire. A rooster behind him. */
  fireInTheCourtyard: require("./men/e6609b22-c3c1-476f-8b60-63ee7a2f5c23.png"),
  /** A narrow gap in a thick wall, opening on light. The centurion's door. */
  narrowGate: require("./others/af3872b3-ff76-4752-928c-010ea8ea3f99.png"),
  /** An open shutter, morning light in a rectangle on a stone floor. */
  shutterAtMorning: require("./others/741a1d15-f714-4d23-ab39-d396972c9585.png"),
  /** A dirt road over a low hill and out of frame at dusk. */
  roadAtDusk: require("./others/078e90cc-e787-49c7-80b2-61d940c6acf9.png"),
} as const;
// The last two are for STORY cards, and stories have no model, no route and no
// seed script in the backend. The art now runs ahead of the feature rather
// than behind it — which is a decision that was made, not an oversight.

/**
 * The seven cultivations, keyed by the slug in STAGE_SLUGS on the backend, so
 * a virtue that came from the API reaches its image without a second table.
 *
 * These are the only square assets in the set — 1254×1254 rather than 3:4 —
 * which is what a circular bubble wants, so they need no upward offset the way
 * the portraits do.
 *
 * They are also the only ones that show the virtue being DONE rather than an
 * object standing for it. That is a better answer than the still lifes they
 * replaced: a virtue is something a person does. It has one cost, which is
 * that a scene with two figures in it loses its subject at 62px while a basin
 * or a vine survives. If more are ever made, single-subject compositions read
 * further down.
 */
export const VIRTUE_SCENES = {
  /** A stone basin, a folded cloth, sandals. */
  humility: require("./virtues/fb529bee-2ff8-4c6c-8c92-97557bee1299.png"),
  /** Bread handed from a basket to a seated family. */
  generosity: require("./virtues/6c2a219a-a1eb-49ff-a1ab-f9a055a9b09d.png"),
  /** A sleeping child held. */
  "pure-love": require("./virtues/001be18b-4c03-4cfd-9f3f-f40eff55b57f.png"),
  /** Open hands at sunrise, a meal set out on the roof. */
  gratitude: require("./virtues/e025defc-736b-4642-b7ec-0d5bf2a4f15e.png"),
  /** One loaf, one cup, a few olives. Enough, and no more. */
  temperance: require("./virtues/2632e4bc-90af-4952-a320-90da0a366568.png"),
  /** Tying a young vine to its stake. */
  patience: require("./virtues/eeb6cbea-7f11-43ee-9e55-86a0b52d2516.png"),
  /** Mending a net on the shore. */
  diligence: require("./virtues/8eddb48e-506a-4491-ad68-a37d579cf6b8.png"),
} as const;
// NOTE: two files in that folder are byte-identical duplicates carrying a
// "(1)" suffix — 2632e4bc and 6c2a219a. Neither is referenced above. Deleting
// them saves 4.3 MB and removes the chance of the wrong one being wired up.

/**
 * The anonymous authors, keyed by the same slug as everyone else so one lookup
 * serves the whole grid.
 *
 * Nine of the thirty-nine writers the API returns have no name, and there is
 * no face to paint for a person nobody can name — so these are PLACES: the
 * room the book came out of. That is the deliberate answer to `portraitFor()`
 * returning null, not a fallback for a missing file.
 *
 * All nine are covered.
 */
export const ANONYMOUS_AUTHOR_SCENES: Readonly<Record<string, number>> = {
  "author-of-judges": require("./the six ananymous authors/8a9f1ef8-e1db-4167-bb11-d0dcd2df0ee8.png"),
  "author-of-ruth": require("./the six ananymous authors/badf1376-78eb-4982-8881-4d529dbd4c50.png"),
  "author-of-kings": require("./the six ananymous authors/479e9f76-8de7-421d-8d01-b811f17f845e.png"),
  "author-of-esther": require("./the six ananymous authors/1dc8ba48-ad6d-499e-b23f-e3f8b39d9106.png"),
  qoheleth: require("./the six ananymous authors/b2e30d66-3470-4e5b-a1d0-ac95b1f92534.png"),
  "author-of-hebrews": require("./the six ananymous authors/b45e9aa5-cdde-495d-b591-7da336dd02b4.png"),
  // The last three come from BOOK_SCENES rather than from their own files:
  // the book and the moment inside it are the same picture.
  "author-of-samuel": require("./thebookscenes/6fd0b45c-955d-4b7e-828b-ddc613f58a8d.png"),
  "the-chronicler": require("./thebookscenes/b9d2cf5d-1edb-4b48-b710-2a38045873c0.png"),
  "author-of-job": require("./thebookscenes/f43cccda-25b3-4562-93a1-074fab2da133.png"),
};

/**
 * One lookup for the whole author grid: a face where there is one, the room
 * the book came out of where there is not, null only where neither exists yet.
 * A caller that wants to know WHICH it got can compare against
 * `AUTHOR_PORTRAITS`, because the two are drawn differently — a face is a
 * person, a room is an admission.
 */
export function authorImageFor(slug: string): number | null {
  return AUTHOR_PORTRAITS[slug] ?? ANONYMOUS_AUTHOR_SCENES[slug] ?? null;
}

/**
 * Book scenes and read headers. The only LANDSCAPE set — 1448×1086 rather than
 * the portrait 1086×1448 — which is the right shape for a card wider than it
 * is tall, and the reason none of these needs the upward offset the portraits
 * do. Centre them.
 *
 * Three do double duty, and that is deliberate rather than thrifty: the
 * rooftop is both the book of Samuel and 2 Samuel 11, the storm is both the
 * book of Job and the whirlwind he is answered out of, and the corridor is
 * both Chronicles and the long argument of Romans.
 */
export const BOOK_SCENES = {
  // Four of these come from `lastbooks`, a second take on the same seven
  // briefs. Where a slot took the newer frame it is because that frame is
  // more specifically the passage — the banquet is lit as a WEDDING rather
  // than a meal, the colonnade recedes further, the doorway's light lands as
  // one clean rectangle. Where it kept the first take, that was also on
  // meaning: Job 38 is a confrontation and the newer storm breaks into
  // sunbeams, which reads as an answer he never gets.
  /** Dry rolling hills under a wide pale sky at first light. Psalms. */
  dryHills: require("./thebookscenes/3cfae549-539a-4262-b340-5db300ddfb14.png"),
  /** A flat roof at night over a sleeping town. Samuel — and 2 Samuel 11. */
  rooftopAtNight: require("./thebookscenes/6fd0b45c-955d-4b7e-828b-ddc613f58a8d.png"),
  /** Pillars receding toward light at the far end. Chronicles, and Romans. */
  colonnade: require("./lastbooks/0f1267f9-5916-4c05-af44-f8ae9d2198a5.png"),
  /** A long table laid, the low seats nearest the viewer. Luke 14. */
  theLowestPlace: require("./lastbooks/1160afbd-3828-4615-9939-c1ae231e26dc.png"),
  /** A storm coming over open rock. Job 38. */
  theWhirlwind: require("./thebookscenes/f43cccda-25b3-4562-93a1-074fab2da133.png"),
  /** Cold flat water, nothing moving on it. The first movement: seeing it. */
  stillWater: require("./thebookscenes/e87a7878-e63a-4b56-abfb-a2fb03a2bb70.png"),
  /** Clear shallow water over pale stones. Psalm 46, and the Psalms collection. */
  waterOverStone: require("./lastbooks/fcfceea2-1d8d-442c-b918-943e9bff7d96.png"),
  /** A wide valley at first light. Romans 8:38-39, and Ruth. */
  valleyAtDawn: require("./lastbooks/386c16ea-bd33-4aff-9e71-aa16608b10cf.png"),
  /** A door standing open on the light, seen from inside. The third movement. */
  theOpenDoor: require("./lastbooks/805fb8be-689e-43f1-94cb-74727480e94d.png"),
} as const;
// Unplaced alternates, kept because they are good and not because they fit:
// lastbooks/40c9cf44 (a rooftop over a walled citadel at night) and
// lastbooks/a9c92bf7 (a storm broken by sunbeams). Both lost their slot on
// meaning rather than on quality. lastbooks/fcfceea2 also ships a byte-identical
// "(1)" duplicate that nothing references.

export type BookSceneName = keyof typeof BOOK_SCENES;
export type VirtueSlug = keyof typeof VIRTUE_SCENES;
export type SceneName = keyof typeof SCENES;
export type DiscipleName = keyof typeof DISCIPLE_PORTRAITS;

/** Null for the anonymous authors. That is an answer, not a missing asset. */
export function portraitFor(slug: string): number | null {
  return AUTHOR_PORTRAITS[slug] ?? null;
}

// ── FRAMING ────────────────────────────────────────────────────────────────
// Every file is 3:4 portrait and every face sits in the upper third, so a
// centred square crop cuts the head off. Anything drawing one of these in a
// circle or a square wants the focal point moved up:
//
//   <Image source={...} resizeMode="cover" style={{ ... }} />
//
// React Native has no object-position, so the usual fix is a wrapper with
// overflow: "hidden" and an inner Image that is taller than the box, offset
// upward — a 4:3 overdraw with a top offset of about -17% of the height.
//
// The subject's NAME is painted into the bottom of each portrait. Every use
// above crops it away. Do not draw a caption over the lower third of one of
// these, and do not use a portrait uncropped next to a text label of the same
// name — it reads as a duplicate.
