// The pure part of the dwell timer, so it can be tested without a React tree
// or a fake AppState.
//
// The hook is a thin wrapper over this. Everything worth getting wrong —
// counting while backgrounded, double-counting on resume — lives here, where a
// test can drive the transitions directly and assert that replaying an event
// changes nothing.

export interface DwellState {
  accumulatedMs: number;
  /** When the OPEN interval began. Null means the clock is stopped. */
  startedAt: number | null;
  running: boolean;
}

export const MAX_DWELL_SECONDS = 3_600;
export const MIN_DWELL_SECONDS = 5;

export function newDwell(): DwellState {
  return { accumulatedMs: 0, startedAt: null, running: false };
}

/** Idempotent. A second open without a close is the resume double-count. */
export function openInterval(s: DwellState, now: number): DwellState {
  if (s.startedAt !== null) return s;
  return { ...s, startedAt: now };
}

/** Idempotent. Closing a stopped clock banks nothing. */
export function closeInterval(s: DwellState, now: number): DwellState {
  if (s.startedAt === null) return s;
  return {
    ...s,
    accumulatedMs: s.accumulatedMs + (now - s.startedAt),
    startedAt: null,
  };
}

export function start(s: DwellState, now: number): DwellState {
  return openInterval({ ...s, running: true }, now);
}

/** Foreground seconds since the last read, then reset. 0 below the minimum. */
export function readAndReset(
  s: DwellState,
  now: number,
): { state: DwellState; seconds: number } {
  const closed = closeInterval(s, now);
  const seconds = Math.floor(closed.accumulatedMs / 1000);
  return {
    state: newDwell(),
    seconds: seconds < MIN_DWELL_SECONDS ? 0 : Math.min(seconds, MAX_DWELL_SECONDS),
  };
}
