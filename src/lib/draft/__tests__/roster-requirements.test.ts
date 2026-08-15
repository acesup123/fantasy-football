import { describe, it, expect } from 'vitest';
import {
  abbreviateName,
  buildOwnerRosters,
  countRoster,
  getRequirementState,
  missingPositions,
  validatePick,
} from '../roster-requirements';
import type { DraftPick, Player } from '@/types/database';

// Minimums: 1 QB, 2 RB, 2 WR, 1 TE, 1 DEF = 7 mandatory picks.

function roster(spec: Record<string, number>): { position: string }[] {
  return Object.entries(spec).flatMap(([position, n]) =>
    Array.from({ length: n }, () => ({ position }))
  );
}

describe('getRequirementState', () => {
  it('reports the full deficit for an empty roster', () => {
    const state = getRequirementState({}, 15);
    expect(state.totalDeficit).toBe(7);
    expect(state.deficits).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 });
    expect(state.requiredNow).toEqual([]);
    expect(state.impossible).toBe(false);
  });

  it('leaves picks unconstrained while there is slack', () => {
    // 7 needed, 8 picks left — one pick of freedom.
    expect(getRequirementState({}, 8).requiredNow).toEqual([]);
  });

  it('forces every remaining pick once deficit equals slots left', () => {
    const state = getRequirementState(countRoster(roster({ RB: 3, WR: 4 })), 3);
    // Still missing QB, TE, DEF with exactly 3 picks left.
    expect(state.totalDeficit).toBe(3);
    expect(state.requiredNow).toEqual(['QB', 'TE', 'DEF']);
  });

  it('counts a multi-short position once per missing player', () => {
    const state = getRequirementState(
      countRoster(roster({ QB: 1, TE: 1, DEF: 1 })),
      4
    );
    expect(state.deficits).toEqual({ RB: 2, WR: 2 });
    expect(state.totalDeficit).toBe(4);
    expect(state.requiredNow).toEqual(['RB', 'WR']);
  });

  it('flags an unfillable roster as impossible', () => {
    // Traded picks away: 3 short, 2 picks left.
    const state = getRequirementState(countRoster(roster({ RB: 2, WR: 2 })), 2);
    expect(state.impossible).toBe(true);
    expect(state.requiredNow).toEqual(['QB', 'TE', 'DEF']);
  });

  it('reports nothing outstanding once the minimums are met', () => {
    const state = getRequirementState(
      countRoster(roster({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 })),
      8
    );
    expect(state.totalDeficit).toBe(0);
    expect(state.requiredNow).toEqual([]);
  });
});

describe('validatePick', () => {
  it('allows anything while there is slack', () => {
    expect(validatePick({}, 15, 'WR')).toEqual({ ok: true });
  });

  it('rejects a pick that would strand a requirement', () => {
    const counts = countRoster(roster({ RB: 3, WR: 4 }));
    const result = validatePick(counts, 3, 'WR');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('3 picks left');
      expect(result.error).toContain('QB/TE/DEF');
    }
  });

  it('allows a deficit position at the same point', () => {
    const counts = countRoster(roster({ RB: 3, WR: 4 }));
    expect(validatePick(counts, 3, 'TE')).toEqual({ ok: true });
  });

  it('allows only the last missing position on the final pick', () => {
    const counts = countRoster(roster({ QB: 1, RB: 2, WR: 2, TE: 1 }));
    expect(validatePick(counts, 1, 'DEF')).toEqual({ ok: true });
    expect(validatePick(counts, 1, 'RB').ok).toBe(false);
  });

  it('singularizes the message on the last pick', () => {
    const counts = countRoster(roster({ QB: 1, RB: 2, WR: 2, TE: 1 }));
    const result = validatePick(counts, 1, 'RB');
    if (!result.ok) expect(result.error).toContain('1 pick left');
  });

  it('still steers toward requirements when already impossible', () => {
    const counts = countRoster(roster({ RB: 2, WR: 2 }));
    expect(validatePick(counts, 2, 'QB')).toEqual({ ok: true });
    expect(validatePick(counts, 2, 'RB').ok).toBe(false);
  });
});

describe('missingPositions', () => {
  it('lists shortfalls in board order', () => {
    expect(missingPositions(countRoster(roster({ RB: 2, WR: 1 })))).toEqual([
      'QB',
      'WR',
      'TE',
      'DEF',
    ]);
  });

  it('returns nothing for a legal roster', () => {
    expect(
      missingPositions(countRoster(roster({ QB: 2, RB: 3, WR: 3, TE: 1, DEF: 1 })))
    ).toEqual([]);
  });
});

describe('buildOwnerRosters', () => {
  const players: Player[] = [
    { id: 1, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', espn_id: null, bye_week: null, is_active: true, created_at: '' },
    { id: 2, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', espn_id: null, bye_week: null, is_active: true, created_at: '' },
    { id: 3, name: "Ja'Marr Chase", position: 'WR', nfl_team: 'CIN', espn_id: null, bye_week: null, is_active: true, created_at: '' },
  ];
  const playerMap = new Map(players.map((p) => [p.id, p]));

  function pick(over: Partial<DraftPick>): DraftPick {
    return {
      id: over.overall_pick ?? 1,
      season_id: 1,
      round: 1,
      pick_in_round: 1,
      overall_pick: 1,
      original_owner_id: 'a',
      current_owner_id: 'a',
      player_id: null,
      is_keeper: false,
      keeper_year: null,
      is_auto_pick: false,
      picked_at: null,
      created_at: '',
      ...over,
    } as DraftPick;
  }

  it('groups drafted players by position and counts open slots', () => {
    const rosters = buildOwnerRosters(
      [
        pick({ overall_pick: 1, player_id: 3 }),
        pick({ overall_pick: 2, player_id: 1 }),
        pick({ overall_pick: 3, player_id: null }),
        pick({ overall_pick: 4, current_owner_id: 'b', player_id: 2 }),
      ],
      playerMap
    );

    const a = rosters.get('a')!;
    expect(a.filled).toBe(2);
    expect(a.slotsRemaining).toBe(1);
    expect(a.counts).toEqual({ QB: 1, WR: 1 });
    expect(a.byPosition.map((g) => g.position)).toEqual(['QB', 'RB', 'WR', 'TE', 'DEF']);
    expect(a.byPosition[0].players[0].player.name).toBe('Josh Allen');

    // A traded pick lands on the roster of whoever holds it now.
    expect(rosters.get('b')!.counts).toEqual({ RB: 1 });
  });

  it('credits a traded pick to the current owner, not the original', () => {
    const rosters = buildOwnerRosters(
      [pick({ overall_pick: 1, original_owner_id: 'a', current_owner_id: 'b', player_id: 1 })],
      playerMap
    );
    expect(rosters.get('b')!.counts).toEqual({ QB: 1 });
    expect(rosters.has('a')).toBe(false);
  });
});

describe('abbreviateName', () => {
  it('shortens the first name to an initial', () => {
    expect(abbreviateName('Patrick Mahomes')).toBe('P. Mahomes');
  });

  it('keeps suffixed surnames intact', () => {
    expect(abbreviateName('Marvin Harrison Jr.')).toBe('M. Harrison Jr.');
  });

  it('leaves defenses and single names alone', () => {
    expect(abbreviateName('49ers D/ST')).toBe('49ers D/ST');
    expect(abbreviateName('Chase')).toBe('Chase');
  });
});
