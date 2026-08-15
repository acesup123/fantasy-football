import type { DraftPick } from '@/types/database';

/**
 * Reversing a pick mid-draft.
 *
 * Someone picks the wrong player — misclick, wrong row in the pool, a
 * commissioner entering a pick for an absent owner off a bad text message.
 * Without this the only fix is /api/draft/reset, which clears the whole board.
 *
 * Two rules do the real work here:
 *
 *   Keepers are never undoable. 60 of the 180 slots are pre-filled keepers,
 *   and they are set in ESPN, not in this app. Clearing one would put an
 *   open slot where the board expects a keeper and hand the player back to
 *   the pool for anyone to draft.
 *
 *   "The last pick" means the most recent by picked_at, not the highest
 *   numbered. Once an earlier slot has been undone and re-picked, those two
 *   are different, and the highest-numbered one is not the one that just
 *   happened.
 *
 * The pointer rule is deliberately "earliest slot still needing a pick"
 * rather than "the slot we just cleared". They are the same in the ordinary
 * case, but if the board already has a hole in it the earliest-open rule
 * closes the oldest one first instead of stranding it.
 */

/** The subset of a draft_picks row these rules need. */
export type UndoCandidate = Pick<
  DraftPick,
  'overall_pick' | 'player_id' | 'picked_at' | 'is_keeper'
>;

export type UndoResolution<T> =
  | { ok: true; pick: T }
  | { ok: false; error: string };

/** A live pick is one an owner actually made: filled, and not a keeper slot. */
function isLive(pick: UndoCandidate): boolean {
  return pick.player_id !== null && !pick.is_keeper;
}

/**
 * The most recently made live pick, or null if none have been made.
 *
 * Sorted by picked_at descending, falling back to overall_pick for rows with
 * no timestamp (picks written before picked_at was recorded) so the ordering
 * is still total.
 */
export function findLastLivePick<T extends UndoCandidate>(picks: T[]): T | null {
  const live = picks.filter(isLive);
  if (live.length === 0) return null;

  return live.reduce((latest, pick) => {
    const a = pick.picked_at ? Date.parse(pick.picked_at) : NaN;
    const b = latest.picked_at ? Date.parse(latest.picked_at) : NaN;

    // Both timestamped: newest wins. Otherwise fall back to board position,
    // which is the order picks were made in when nothing has been undone.
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      if (a !== b) return a > b ? pick : latest;
      return pick.overall_pick > latest.overall_pick ? pick : latest;
    }
    if (!Number.isNaN(a)) return pick;
    if (!Number.isNaN(b)) return latest;
    return pick.overall_pick > latest.overall_pick ? pick : latest;
  });
}

/**
 * Decide which pick an undo request refers to.
 *
 * `requested` is the caller naming an explicit slot; omitting it means "undo
 * whatever just happened". Errors are phrased for the commissioner reading
 * them, since this route has no UI of its own for most failures.
 */
export function resolveUndoTarget<T extends UndoCandidate>(
  picks: T[],
  requested?: number | null
): UndoResolution<T> {
  if (requested === undefined || requested === null) {
    const last = findLastLivePick(picks);
    if (!last) {
      return { ok: false, error: 'No picks have been made yet — nothing to undo' };
    }
    return { ok: true, pick: last };
  }

  const pick = picks.find((p) => p.overall_pick === requested);

  if (!pick) {
    return { ok: false, error: `Pick #${requested} is not on this board` };
  }
  if (pick.is_keeper) {
    return {
      ok: false,
      error: `Pick #${requested} is a keeper slot. Keepers are set in ESPN, not undone here.`,
    };
  }
  if (pick.player_id === null) {
    return { ok: false, error: `Pick #${requested} has not been made yet` };
  }

  return { ok: true, pick };
}

/**
 * Where the board points once `undoneOverallPick` has been cleared.
 *
 * Treats the undone slot as open rather than trusting the caller to have
 * written it first, so this can be computed before or after the update.
 */
export function pointerAfterUndo(
  picks: UndoCandidate[],
  undoneOverallPick: number
): number {
  const open = picks
    .filter((p) => p.overall_pick === undoneOverallPick || p.player_id === null)
    .map((p) => p.overall_pick);

  // The undone slot is open by definition, so this is never empty — but fall
  // back to it explicitly rather than relying on the caller's array being
  // complete.
  return open.length > 0 ? Math.min(...open) : undoneOverallPick;
}
