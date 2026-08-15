/**
 * The draft clock.
 *
 * The clock has to be the same for everybody. A per-browser countdown drifts —
 * it starts whenever that tab noticed the pick change, so two people watching
 * see different numbers and nobody can agree whether time expired.
 *
 * So the server owns it: it records when the current pick went on the clock,
 * and every client renders the same deadline. Clients also correct for their
 * own clock skew using the server timestamp returned alongside.
 *
 * State lives in `league_settings` (a JSONB key/value table) rather than a new
 * column, so this needs no migration.
 */

export interface DraftClockState {
  /** The pick this clock is for. */
  pickNumber: number;
  /** When that pick went on the clock, epoch ms. */
  startedAt: number;
  paused: boolean;
  /** When the current pause began, epoch ms. Null when running. */
  pausedAt: number | null;
  /** Time already spent paused on THIS pick, ms. Added to the deadline. */
  pausedMs: number;
}

export interface DraftClockView extends DraftClockState {
  /** Epoch ms the pick expires. Null while paused — the clock isn't running. */
  deadline: number | null;
  /** Milliseconds left, floored at zero. */
  remainingMs: number;
  /** Server time, so clients can correct for their own clock being wrong. */
  serverNow: number;
  timerSeconds: number;
}

export function clockKey(seasonId: number): string {
  return `draft_clock:${seasonId}`;
}

/** A fresh clock for a pick going on the clock right now. */
export function startClock(pickNumber: number, now: number): DraftClockState {
  return { pickNumber, startedAt: now, paused: false, pausedAt: null, pausedMs: 0 };
}

/**
 * Derive the view every client renders from.
 *
 * While paused the deadline is null and the remaining time is frozen at
 * whatever was left, so a pause genuinely stops the clock rather than letting
 * it drain in the background.
 */
export function viewClock(
  state: DraftClockState,
  timerSeconds: number,
  now: number
): DraftClockView {
  const budgetMs = timerSeconds * 1000;

  if (state.paused) {
    const elapsedBeforePause = (state.pausedAt ?? now) - state.startedAt - state.pausedMs;
    return {
      ...state,
      deadline: null,
      remainingMs: Math.max(0, budgetMs - elapsedBeforePause),
      serverNow: now,
      timerSeconds,
    };
  }

  const deadline = state.startedAt + state.pausedMs + budgetMs;
  return {
    ...state,
    deadline,
    remainingMs: Math.max(0, deadline - now),
    serverNow: now,
    timerSeconds,
  };
}

/** Pause a running clock, banking nothing — pausedAt marks where it stopped. */
export function pauseClock(state: DraftClockState, now: number): DraftClockState {
  if (state.paused) return state;
  return { ...state, paused: true, pausedAt: now };
}

/** Resume, adding the pause duration to the budget so no time was lost. */
export function resumeClock(state: DraftClockState, now: number): DraftClockState {
  if (!state.paused) return state;
  const pausedFor = now - (state.pausedAt ?? now);
  return { ...state, paused: false, pausedAt: null, pausedMs: state.pausedMs + pausedFor };
}

/** Parse whatever is in league_settings, falling back to a fresh clock. */
export function parseClock(raw: unknown, pickNumber: number, now: number): DraftClockState {
  if (raw && typeof raw === 'object') {
    const c = raw as Partial<DraftClockState>;
    if (typeof c.pickNumber === 'number' && typeof c.startedAt === 'number') {
      // A stale clock from an earlier pick means this pick just went live.
      if (c.pickNumber !== pickNumber) return startClock(pickNumber, now);
      return {
        pickNumber: c.pickNumber,
        startedAt: c.startedAt,
        paused: Boolean(c.paused),
        pausedAt: typeof c.pausedAt === 'number' ? c.pausedAt : null,
        pausedMs: typeof c.pausedMs === 'number' ? c.pausedMs : 0,
      };
    }
  }
  return startClock(pickNumber, now);
}
