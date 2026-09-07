// The client's dwell timer, driven as pure transitions.
//
// THE FIRST TEST IN THE FRONTEND WORKSPACE. vitest was already configured here
// with --passWithNoTests, which is to say it was ready and empty.
//
// What this protects is not points — the server caps dwell at 20 a day however
// much arrives — it is the TELEMETRY. An inflated dwell number is not a cheat,
// it is a lie in the data that later decides what gets built.
//
// THE TEST THAT MATTERS is not "does it produce a plausible number". It is
// "does replaying the same event change the answer", because the likeliest bug
// — a double-count on resume — produces entirely plausible numbers.

import { describe, expect, it } from "vitest";

import {
  closeInterval,
  MAX_DWELL_SECONDS,
  MIN_DWELL_SECONDS,
  newDwell,
  openInterval,
  readAndReset,
  start,
} from "../dwell";

const T0 = 1_000_000;
const mins = (n: number) => n * 60_000;

describe("foreground only", () => {
  it("counts a straightforward read", () => {
    const s = start(newDwell(), T0);
    expect(readAndReset(s, T0 + mins(10)).seconds).toBe(600);
  });

  it("DOES NOT COUNT while backgrounded", () => {
    // Open a passage, read for five minutes, lock the phone overnight, come
    // back and close it. The naive mount/unmount timer reports nine hours.
    let s = start(newDwell(), T0);
    s = closeInterval(s, T0 + mins(5)); // backgrounded
    s = openInterval(s, T0 + mins(545)); // back, nine hours later
    const { seconds } = readAndReset(s, T0 + mins(546));

    expect(seconds).toBe(360); // five minutes plus the one after returning
    expect(seconds).toBeLessThan(mins(9) / 1000 + 600);
  });

  it("treats `inactive` as away, so a notification banner is not reading", () => {
    // Modelled by the same closeInterval the hook calls for any non-active
    // state. Five minutes read, two minutes with a banner up, one more minute.
    let s = start(newDwell(), T0);
    s = closeInterval(s, T0 + mins(5));
    s = openInterval(s, T0 + mins(7));
    expect(readAndReset(s, T0 + mins(8)).seconds).toBe(360);
  });
});

describe("the resume double-count", () => {
  it("IGNORES a second resume with no background between", () => {
    // iOS emits inactive -> active for a banner, a control-centre pull or a
    // Face ID prompt. A handler that restarts the clock on every `active`
    // counts the interval it never closed a second time.
    let s = start(newDwell(), T0);
    s = openInterval(s, T0 + mins(5)); // stray `active`
    s = openInterval(s, T0 + mins(7)); // and another
    expect(readAndReset(s, T0 + mins(10)).seconds).toBe(600);
  });

  it("IGNORES a second background with no resume between", () => {
    let s = start(newDwell(), T0);
    s = closeInterval(s, T0 + mins(5));
    s = closeInterval(s, T0 + mins(9)); // stray, must bank nothing
    s = openInterval(s, T0 + mins(10));
    expect(readAndReset(s, T0 + mins(11)).seconds).toBe(360);
  });

  it("ABAB and AABB produce the same total — the property, not the number", () => {
    const clean = () => {
      let s = start(newDwell(), T0);
      s = closeInterval(s, T0 + mins(4));
      s = openInterval(s, T0 + mins(6));
      return readAndReset(s, T0 + mins(9)).seconds;
    };
    const noisy = () => {
      let s = start(newDwell(), T0);
      s = openInterval(s, T0 + mins(2)); // duplicate active
      s = closeInterval(s, T0 + mins(4));
      s = closeInterval(s, T0 + mins(5)); // duplicate background
      s = openInterval(s, T0 + mins(6));
      s = openInterval(s, T0 + mins(8)); // duplicate active
      return readAndReset(s, T0 + mins(9)).seconds;
    };
    expect(noisy()).toBe(clean());
    expect(clean()).toBe(420);
  });
});

describe("reading is destructive, and bounded", () => {
  it("resets, so the same seconds are never sent twice", () => {
    // A non-destructive read invites the caller to PATCH the same seconds
    // twice, which is the resume double-count wearing a different hat.
    const s = start(newDwell(), T0);
    const first = readAndReset(s, T0 + mins(10));
    expect(first.seconds).toBe(600);
    expect(readAndReset(first.state, T0 + mins(20)).seconds).toBe(0);
  });

  it("returns 0 for a glance, so no PATCH is made at all", () => {
    const s = start(newDwell(), T0);
    expect(readAndReset(s, T0 + 3_000).seconds).toBe(0);
    expect(MIN_DWELL_SECONDS).toBe(5);
  });

  it("truncates rather than sending a value the server will reject", () => {
    // A rejected PATCH loses the dwell entirely, which is worse than a
    // truncated one. This mirrors the schema's ceiling.
    const s = start(newDwell(), T0);
    expect(readAndReset(s, T0 + mins(600)).seconds).toBe(MAX_DWELL_SECONDS);
    expect(MAX_DWELL_SECONDS).toBe(3_600);
  });

  it("counts nothing before start() — mounting a screen is not reading it", () => {
    const s = newDwell();
    expect(s.running).toBe(false);
    expect(openInterval(s, T0).running).toBe(false);
  });
});
