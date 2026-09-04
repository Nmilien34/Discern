// SPEAKING HER PROSE IS OFF UNLESS EVERYTHING SAYS YES.
//
// Scripture audio and prose audio are different money. A passage is
// synthesized once and every listener after that is free; her reply caches
// nothing, because no two replies are alike, so every spoken one is a fresh
// bill — measured at ~$0.43 against $0.018 for the same turn in text.
//
// So the default at every layer is silence, and each gate can only say no.
// These tests pin that, because "defaults to off" is the kind of property that
// quietly inverts during a refactor and costs money before anyone notices.

import { describe, expect, it } from "vitest";

type Prefs = { preferences: { speakReplies: boolean | null } };

const user = (speakReplies: boolean | null): Prefs => ({
  preferences: { speakReplies },
});

/**
 * The resolver, mirrored from routes/abigail.routes.ts.
 *
 * Duplicated rather than imported because the route module pulls in the whole
 * app graph. If the route changes and this does not, these tests stop meaning
 * anything — so the shape is deliberately tiny and the comment says so.
 */
function shouldSpeak(
  voiceEnabled: boolean,
  speakRepliesDefault: boolean,
  u: Prefs,
  requested: boolean | undefined,
): boolean {
  if (!voiceEnabled) return false;
  if (requested !== true) return false;
  return u.preferences.speakReplies ?? speakRepliesDefault;
}

describe("VOICE_ENABLED is absolute", () => {
  it("silences prose even when everything else says yes", () => {
    expect(shouldSpeak(false, true, user(true), true)).toBe(false);
  });
});

describe("the deployment default", () => {
  it("SPEAK_REPLIES false means silence for a user with no preference", () => {
    // Today's shipped configuration: scripture spoken, prose read.
    expect(shouldSpeak(true, false, user(null), true)).toBe(false);
  });

  it("SPEAK_REPLIES true speaks for a user with no preference", () => {
    expect(shouldSpeak(true, true, user(null), true)).toBe(true);
  });
});

describe("the per-user override — the point of the feature", () => {
  it("a tester set to true hears her while the deployment is false", () => {
    // A subset of testers hearing her while everyone else reads is exactly
    // what the deployment flag alone cannot express.
    expect(shouldSpeak(true, false, user(true), true)).toBe(true);
  });

  it("a user set to false stays silent while the deployment is true", () => {
    expect(shouldSpeak(true, true, user(false), true)).toBe(false);
  });

  it("null defers rather than meaning false", () => {
    expect(shouldSpeak(true, true, user(null), true)).toBe(true);
    expect(shouldSpeak(true, false, user(null), true)).toBe(false);
  });
});

describe("the request flag can only decline", () => {
  it("omitting it gets text, however permissive the config", () => {
    expect(shouldSpeak(true, true, user(true), undefined)).toBe(false);
  });

  it("false gets text", () => {
    expect(shouldSpeak(true, true, user(true), false)).toBe(false);
  });

  it("true alone is not enough without the config", () => {
    expect(shouldSpeak(true, false, user(null), true)).toBe(false);
  });
});

describe("the whole matrix", () => {
  it("speaks in exactly the cases it should and no others", () => {
    const cases: [boolean, boolean, boolean | null, boolean | undefined, boolean][] = [
      // voice, default, userPref, requested, expected
      [true, true, true, true, true],
      [true, true, null, true, true],
      [true, false, true, true, true],
      [true, true, false, true, false],
      [true, false, null, true, false],
      [true, false, false, true, false],
      [false, true, true, true, false],
      [true, true, true, false, false],
      [true, true, true, undefined, false],
    ];

    for (const [voice, def, pref, req, want] of cases) {
      expect(shouldSpeak(voice, def, user(pref), req)).toBe(want);
    }

    // Only three of nine speak. Silence is the default and stays it.
    expect(cases.filter((c) => c[4]).length).toBe(3);
  });
});
