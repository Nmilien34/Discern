// Foreground dwell time, measured on the client.
//
// WHAT A WRONG VALUE COSTS. Not points — the server caps dwell at 20 points a
// day however much is reported, and there is no leaderboard, no comparison and
// nothing to buy. What a wrong value costs is the telemetry: if this counts
// while the app is backgrounded, or double-counts on resume, then every
// engagement number we later reason from is quietly inflated, and those numbers
// decide what gets built next.
//
// So this is built to be correct rather than defended.
//
// ── THE TWO BUGS THIS IS SHAPED AROUND ──────────────────────────────────────
//
// 1. COUNTING WHILE BACKGROUNDED. The naive version records a start time on
//    mount and subtracts on unmount. A person who opens a passage, locks the
//    phone and comes back the next morning reports nine hours of attention.
//    Fixed by accumulating only across foreground intervals: the clock stops on
//    background and a new interval starts on return.
//
// 2. DOUBLE-COUNTING ON RESUME — the likelier bug and the harder one to notice,
//    because it produces BELIEVABLE numbers. Twenty real minutes arrives as
//    forty, which passes any ceiling worth having and looks like an engaged
//    reader. It happens when `active` fires without a matching `background`
//    first, or fires twice: iOS emits `inactive` -> `active` for a notification
//    banner, a control-centre pull or a Face ID prompt, and a handler that
//    restarts the clock on every `active` counts the interval it never closed a
//    second time.
//
//    Fixed by making the open interval EXPLICIT AND SINGULAR. `startedAt` is
//    null whenever the clock is stopped, and:
//      - a resume is ignored when `startedAt` is already set
//      - a background is ignored when `startedAt` is already null
//    So the transitions are idempotent, and the sequences AABB and ABAB both
//    produce the same total. The test for this is not "does it look right", it
//    is "does replaying the same event twice change the answer".
//
// `inactive` is treated as BACKGROUND, deliberately. A banner covering the
// screen is not reading, and the alternative — treating it as foreground —
// means the notification-shade pull silently counts.

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import type { DwellState } from "./dwell";
import * as dwell from "./dwell";

export interface DwellTimer {
  /** Call when the passage becomes visible. Idempotent. */
  start: () => void;
  /**
   * Whole foreground seconds since the last read, and RESETS THE COUNTER.
   *
   * Reading is destructive on purpose: the value is about to be sent, and a
   * non-destructive read invites the caller to send the same seconds twice —
   * which is the resume double-count wearing a different hat.
   *
   * Returns 0 below MIN_DWELL_SECONDS, so a glance sends nothing.
   */
  readAndReset: () => number;
}

export function useDwellTimer(): DwellTimer {
  // All the logic worth getting wrong lives in ./dwell as pure transitions, so
  // it can be tested by replaying events rather than by faking AppState.
  const state = useRef<DwellState>(dwell.newDwell());

  const start = useCallback((): void => {
    state.current = dwell.start(state.current, Date.now());
  }, []);

  const readAndReset = useCallback((): number => {
    const result = dwell.readAndReset(state.current, Date.now());
    state.current = result.state;
    return result.seconds;
  }, []);

  useEffect(() => {
    const onChange = (next: AppStateStatus): void => {
      // Nothing accumulates until the screen says it is being read.
      if (!state.current.running) return;
      state.current =
        next === "active"
          ? dwell.openInterval(state.current, Date.now())
          : // "inactive" counts as away: a banner over the screen is not reading.
            dwell.closeInterval(state.current, Date.now());
    };

    const subscription = AppState.addEventListener("change", onChange);
    return () => {
      subscription.remove();
      // Unmount closes the interval so navigating away cannot leave the clock
      // running into the next screen.
      state.current = dwell.closeInterval(state.current, Date.now());
    };
  }, []);

  return { start, readAndReset };
}
