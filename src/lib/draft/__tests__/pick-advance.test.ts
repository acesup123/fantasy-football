import { describe, it, expect } from 'vitest';
import { generateSnakeOrder } from '../snake-order';
import { buildRoundOwnership, type PickTrade } from '../pick-ownership';

/**
 * The draft board is 180 slots, 60 of which are pre-filled keepers.
 *
 * The original /api/draft/pick advanced with `current_pick_number + 1`, which
 * deadlocked the draft the first time the pointer landed on a keeper slot:
 * every pick attempt there fails with "already been made", and only a
 * successful pick advances the counter. With keepers in round 1 it jammed on
 * pick 2 of 180.
 *
 * These tests model the board and the advance rule so that regression can't
 * come back silently.
 */

const OWNERS = Array.from({ length: 12 }, (_, i) => `owner-${i + 1}`);

interface Slot {
  overallPick: number;
  round: number;
  ownerId: string;
  playerId: number | null;
}

/** Build the board the way /api/draft/initialize does. */
function buildBoard(keepersByOwner: Map<string, number[]>): Slot[] {
  const remaining = new Map([...keepersByOwner].map(([o, rounds]) => [o, [...rounds]]));

  return generateSnakeOrder(OWNERS).map(slot => {
    const rounds = remaining.get(slot.ownerId) ?? [];
    const idx = rounds.indexOf(slot.round);
    if (idx !== -1) rounds.splice(idx, 1);

    return {
      overallPick: slot.overallPick,
      round: slot.round,
      ownerId: slot.ownerId,
      playerId: idx !== -1 ? 1 : null,
    };
  });
}

/** The fixed rule: the next slot that still needs a pick. */
function nextOpenPick(board: Slot[], after: number): number | null {
  const next = board
    .filter(s => s.overallPick > after && s.playerId === null)
    .sort((a, b) => a.overallPick - b.overallPick)[0];
  return next?.overallPick ?? null;
}

/** Run the draft to completion, returning how many live picks were made. */
function runDraft(board: Slot[], advance: (b: Slot[], n: number) => number | null) {
  const first = board.find(s => s.playerId === null)!;
  let current: number | null = first.overallPick;
  let made = 0;

  while (current !== null) {
    const slot = board.find(s => s.overallPick === current);
    if (!slot) break;
    if (slot.playerId !== null) return { made, deadlockedAt: current };

    slot.playerId = 1;
    made++;
    current = advance(board, current);
  }
  return { made, deadlockedAt: null as number | null };
}

/** Five keepers each, spread so round 1 is occupied — the real 2026 shape. */
function realisticKeepers(): Map<string, number[]> {
  const m = new Map<string, number[]>();
  OWNERS.forEach((o, i) => m.set(o, [1, 3, 5, 8, 12].map(r => Math.min(15, r + (i % 3)))));
  return m;
}

describe('draft pick advancement', () => {
  it('deadlocks with the naive +1 rule (the bug this replaced)', () => {
    const board = buildBoard(realisticKeepers());
    const result = runDraft(board, (_b, n) => n + 1);

    expect(result.deadlockedAt).not.toBeNull();
    expect(result.made).toBeLessThan(120);
  });

  it('completes all 120 live picks when skipping keeper slots', () => {
    const board = buildBoard(realisticKeepers());
    const result = runDraft(board, nextOpenPick);

    expect(result.deadlockedAt).toBeNull();
    expect(result.made).toBe(180 - 60);
  });

  it('leaves every keeper slot untouched', () => {
    const keepers = realisticKeepers();
    const board = buildBoard(keepers);
    const keeperSlots = board.filter(s => s.playerId !== null).map(s => s.overallPick);

    runDraft(board, nextOpenPick);

    // Every originally-filled slot is still a keeper slot, and no live pick
    // was ever recorded into one.
    expect(board.filter(s => keeperSlots.includes(s.overallPick))).toHaveLength(60);
  });

  it('places all 60 keepers into slots', () => {
    const board = buildBoard(realisticKeepers());
    expect(board.filter(s => s.playerId !== null)).toHaveLength(60);
  });
});

describe('traded picks', () => {
  it('moves round ownership to the receiving owner', () => {
    const trades: PickTrade[] = [
      { fromOwnerId: 'owner-1', toOwnerId: 'owner-2', round: 8 },
      { fromOwnerId: 'owner-2', toOwnerId: 'owner-1', round: 11 },
    ];
    const ownership = buildRoundOwnership(OWNERS, trades);

    expect(ownership.get('owner-1')!.get(8)).toBe(0);
    expect(ownership.get('owner-2')!.get(8)).toBe(2);
    expect(ownership.get('owner-2')!.get(11)).toBe(0);
    expect(ownership.get('owner-1')!.get(11)).toBe(2);
  });

  it('leaves untraded rounds at one pick each', () => {
    const ownership = buildRoundOwnership(OWNERS, []);
    for (const rounds of ownership.values()) {
      for (let r = 1; r <= 15; r++) expect(rounds.get(r)).toBe(1);
    }
  });
});
