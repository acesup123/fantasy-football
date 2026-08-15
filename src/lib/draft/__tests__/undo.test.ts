import { describe, it, expect } from 'vitest';
import {
  findLastLivePick,
  resolveUndoTarget,
  pointerAfterUndo,
  type UndoCandidate,
} from '../undo';

/**
 * The board is 180 slots, 60 of them pre-filled keepers.
 *
 * The cases that matter are the ones where "the last pick" is ambiguous:
 * a keeper sitting above every live pick, and a re-picked slot that is newer
 * in time but lower on the board.
 */

function slot(
  overall_pick: number,
  opts: Partial<UndoCandidate> = {}
): UndoCandidate {
  return {
    overall_pick,
    player_id: null,
    picked_at: null,
    is_keeper: false,
    ...opts,
  };
}

/** A live pick: made by an owner at a given time. */
function made(overall_pick: number, at: string, player_id = 100): UndoCandidate {
  return slot(overall_pick, { player_id, picked_at: at });
}

/** A keeper slot: filled, but not something anyone picked. */
function keeper(overall_pick: number, player_id = 900): UndoCandidate {
  return slot(overall_pick, { player_id, is_keeper: true, picked_at: null });
}

describe('findLastLivePick', () => {
  it('returns null when nothing has been picked', () => {
    expect(findLastLivePick([slot(1), slot(2), slot(3)])).toBeNull();
  });

  it('returns null when the only filled slots are keepers', () => {
    expect(findLastLivePick([keeper(1), keeper(2), slot(3)])).toBeNull();
  });

  it('picks the most recent by timestamp', () => {
    const picks = [
      made(1, '2026-08-15T10:00:00Z'),
      made(2, '2026-08-15T10:05:00Z'),
      made(3, '2026-08-15T10:02:00Z'),
    ];
    expect(findLastLivePick(picks)?.overall_pick).toBe(2);
  });

  it('never returns a keeper, even one later on the board', () => {
    const picks = [made(1, '2026-08-15T10:00:00Z'), keeper(50)];
    expect(findLastLivePick(picks)?.overall_pick).toBe(1);
  });

  it('prefers the newest pick over the highest-numbered one', () => {
    // Pick 12 was undone and re-picked after 40 was made. The thing that just
    // happened is 12, even though 40 sits further down the board.
    const picks = [
      made(12, '2026-08-15T11:00:00Z'),
      made(40, '2026-08-15T10:30:00Z'),
    ];
    expect(findLastLivePick(picks)?.overall_pick).toBe(12);
  });

  it('falls back to board position when timestamps are missing', () => {
    const picks = [
      slot(5, { player_id: 1 }),
      slot(9, { player_id: 2 }),
      slot(7, { player_id: 3 }),
    ];
    expect(findLastLivePick(picks)?.overall_pick).toBe(9);
  });

  it('prefers a timestamped pick over an untimestamped one', () => {
    const picks = [slot(9, { player_id: 1 }), made(3, '2026-08-15T10:00:00Z')];
    expect(findLastLivePick(picks)?.overall_pick).toBe(3);
  });
});

describe('resolveUndoTarget', () => {
  const board = [
    keeper(1),
    made(2, '2026-08-15T10:00:00Z'),
    made(3, '2026-08-15T10:01:00Z'),
    slot(4),
  ];

  it('defaults to the last live pick when no slot is named', () => {
    const result = resolveUndoTarget(board);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pick.overall_pick).toBe(3);
  });

  it('resolves an explicitly named slot', () => {
    const result = resolveUndoTarget(board, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pick.overall_pick).toBe(2);
  });

  it('refuses a keeper slot', () => {
    const result = resolveUndoTarget(board, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/keeper/i);
  });

  it('refuses a slot nobody has picked yet', () => {
    const result = resolveUndoTarget(board, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not been made/i);
  });

  it('refuses a slot that is not on the board', () => {
    const result = resolveUndoTarget(board, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not on this board/i);
  });

  it('refuses when nothing has been picked at all', () => {
    const result = resolveUndoTarget([keeper(1), slot(2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing to undo/i);
  });
});

describe('pointerAfterUndo', () => {
  it('lands on the undone slot in the ordinary case', () => {
    const board = [
      keeper(1),
      made(2, '2026-08-15T10:00:00Z'),
      made(3, '2026-08-15T10:01:00Z'),
      slot(4),
      slot(5),
    ];
    expect(pointerAfterUndo(board, 3)).toBe(3);
  });

  it('closes the oldest hole first when the board already has one', () => {
    // Slot 2 was undone earlier and never re-picked. Undoing 5 should send the
    // board back to 2, not strand it behind the newer hole.
    const board = [
      keeper(1),
      slot(2),
      made(3, '2026-08-15T10:01:00Z'),
      made(5, '2026-08-15T10:03:00Z'),
    ];
    expect(pointerAfterUndo(board, 5)).toBe(2);
  });

  it('never lands on a keeper slot, since keepers are never open', () => {
    const board = [made(1, '2026-08-15T10:00:00Z'), keeper(2), keeper(3), slot(4)];
    expect(pointerAfterUndo(board, 1)).toBe(1);
  });

  it('reopens a completed board at the undone slot', () => {
    // Every slot filled — undoing the last one is the only thing that opens up.
    const board = [
      keeper(1),
      made(2, '2026-08-15T10:00:00Z'),
      made(3, '2026-08-15T10:01:00Z'),
    ];
    expect(pointerAfterUndo(board, 3)).toBe(3);
  });
});
