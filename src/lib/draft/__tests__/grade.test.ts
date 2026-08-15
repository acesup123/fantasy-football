import { describe, it, expect } from 'vitest';
import {
  gradeDraft,
  pickStarters,
  curveScores,
  displayGrade,
  DRAFT_WEIGHTS,
  ROSTER_WEIGHTS,
  type RankEntry,
} from '../grade';
import type { DraftPick, Owner, Player } from '@/types/database';

let nextId = 1;
function player(name: string, position: Player['position'], rank: number, bye = 7): Player {
  return {
    id: nextId++,
    name,
    position,
    nfl_team: 'XX',
    espn_id: `e${nextId}`,
    bye_week: bye,
    is_active: true,
    created_at: '',
  };
}

function owner(id: string): Owner {
  return {
    id,
    name: id,
    email: null,
    team_name: `${id} FC`,
    avatar_url: null,
    joined_year: 2020,
    is_active: true,
    is_commissioner: false,
    created_at: '',
  };
}

/** Build a 15-player roster for one owner, with ranks, as picks + rank map. */
function buildTeam(
  ownerId: string,
  spec: { name: string; pos: Player['position']; rank: number; bye?: number; keeperRound?: number }[],
  startOverall = 1
) {
  const players: Player[] = [];
  const picks: DraftPick[] = [];
  const ranks: Record<string, RankEntry> = {};

  spec.forEach((s, i) => {
    const p = player(s.name, s.pos, s.rank, s.bye ?? 7);
    players.push(p);
    ranks[p.espn_id as string] = { rank: s.rank, adp: null };
    const overall = startOverall + i * 12;
    picks.push({
      id: overall,
      season_id: 1,
      round: Math.floor(i) + 1,
      pick_in_round: 1,
      overall_pick: overall,
      original_owner_id: ownerId,
      current_owner_id: ownerId,
      player_id: p.id,
      is_keeper: s.keeperRound !== undefined,
      keeper_year: s.keeperRound !== undefined ? 1 : null,
      picked_at: null,
      is_auto_pick: false,
      created_at: '',
    } as DraftPick);
  });

  return { players, picks, ranks };
}

/**
 * A realistic player universe to grade against.
 *
 * Scoring is positional — a player's worth is his rank within his position
 * measured against the last starter at that position — and the achievable
 * ceiling is derived from the pool. Handing gradeDraft only the fifteen players
 * on one roster makes every one of them the best at his position and collapses
 * both, so the fixtures carry a full pool the way production does.
 */
const POOL_DEPTH: Record<Player['position'], number> = {
  QB: 40,
  RB: 60,
  WR: 60,
  TE: 25,
  DEF: 20,
};

function universe(): { players: Player[]; ranks: Record<string, RankEntry> } {
  const players: Player[] = [];
  const ranks: Record<string, RankEntry> = {};
  let rank = 1;

  for (const [position, depth] of Object.entries(POOL_DEPTH)) {
    for (let i = 0; i < depth; i++) {
      // Spread each position across the overall board rather than clustering it.
      const overall = rank + i * 3;
      const p = player(
        `pool ${position}${i + 1}`,
        position as Player['position'],
        overall
      );
      players.push(p);
      ranks[p.espn_id as string] = { rank: overall, adp: null };
    }
    rank += 2;
  }

  return { players, ranks };
}

/** Merge a team's players into a full pool, as the app does. */
function withPool(teamPlayers: Player[], teamRanks: Record<string, RankEntry>) {
  const u = universe();
  return {
    playerMap: new Map([...u.players, ...teamPlayers].map((p) => [p.id, p])),
    ranks: { ...u.ranks, ...teamRanks },
  };
}

/** A legal 15-man roster template; positions/ranks overridden per test. */
const BALANCED = [
  { name: 'QB A', pos: 'QB' as const, rank: 10 },
  { name: 'QB B', pos: 'QB' as const, rank: 30 },
  { name: 'RB A', pos: 'RB' as const, rank: 5 },
  { name: 'RB B', pos: 'RB' as const, rank: 25 },
  { name: 'RB C', pos: 'RB' as const, rank: 60 },
  { name: 'RB D', pos: 'RB' as const, rank: 90 },
  { name: 'RB E', pos: 'RB' as const, rank: 120 },
  { name: 'WR A', pos: 'WR' as const, rank: 8 },
  { name: 'WR B', pos: 'WR' as const, rank: 20 },
  { name: 'WR C', pos: 'WR' as const, rank: 45 },
  { name: 'WR D', pos: 'WR' as const, rank: 80 },
  { name: 'WR E', pos: 'WR' as const, rank: 110 },
  { name: 'TE A', pos: 'TE' as const, rank: 35 },
  { name: 'TE B', pos: 'TE' as const, rank: 100 },
  { name: 'DEF A', pos: 'DEF' as const, rank: 150 },
];

describe('pickStarters', () => {
  it('fills all nine slots from a balanced roster', () => {
    const roster = BALANCED.map((s) => ({
      player: player(s.name, s.pos, s.rank),
      rank: s.rank,
    }));
    const starters = pickStarters(roster);

    expect(starters.map((s) => s.slot)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SF', 'DEF',
    ]);
    expect(starters.every((s) => s.player !== null)).toBe(true);
  });

  it('never starts the same player in two slots', () => {
    const roster = BALANCED.map((s) => ({
      player: player(s.name, s.pos, s.rank),
      rank: s.rank,
    }));
    const ids = pickStarters(roster).map((s) => s.player?.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts the second QB in the superflex slot when one is available', () => {
    const roster = BALANCED.map((s) => ({
      player: player(s.name, s.pos, s.rank),
      rank: s.rank,
    }));
    const sf = pickStarters(roster).find((s) => s.slot === 'SF');
    expect(sf?.player?.position).toBe('QB');
  });

  it('leaves the DEF slot empty rather than filling it with a skill player', () => {
    const roster = BALANCED.filter((s) => s.pos !== 'DEF').map((s) => ({
      player: player(s.name, s.pos, s.rank),
      rank: s.rank,
    }));
    const def = pickStarters(roster).find((s) => s.slot === 'DEF');
    expect(def?.player).toBeNull();
  });

  it('falls back to a skill player in superflex when there is only one QB', () => {
    const oneQb = BALANCED.filter((s) => s.name !== 'QB B');
    const roster = oneQb.map((s) => ({
      player: player(s.name, s.pos, s.rank),
      rank: s.rank,
    }));
    const sf = pickStarters(roster).find((s) => s.slot === 'SF');
    expect(sf?.player).not.toBeNull();
    expect(sf?.player?.position).not.toBe('QB');
  });
});

describe('gradeDraft — superflex is the differentiator', () => {
  function gradeOf(spec: typeof BALANCED, ownerId = 'a') {
    const { picks, players, ranks } = buildTeam(ownerId, spec);
    return gradeDraft({
      picks,
      owners: [owner(ownerId)],
      ...withPool(players, ranks),
    })[0];
  }

  it('scores a two-QB roster far above the same roster with one QB', () => {
    const twoQb = gradeOf(BALANCED);
    // Swap the second QB for an equivalent-rank receiver.
    const oneQb = gradeOf(
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      )
    );

    expect(twoQb.roster.components.superflex).toBeGreaterThan(oneQb.roster.components.superflex);
    expect(twoQb.roster.score).toBeGreaterThan(oneQb.roster.score);
    expect(oneQb.qbRoom).toHaveLength(1);
  });

  it('rewards a third quarterback, but less than the second', () => {
    const two = gradeOf(BALANCED);
    // Rank matters: a 37th-ranked quarterback is below replacement in a
    // 22-QB-start league and correctly adds nothing, so QB C has to be a real
    // starter for the third-arm bonus to mean anything.
    const three = gradeOf(
      BALANCED.map((s) =>
        s.name === 'WR E'
          ? { name: 'QB C', pos: 'QB' as const, rank: 50 }
          : s
      )
    );
    const one = gradeOf(
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      )
    );

    const secondQbGain = two.roster.components.superflex - one.roster.components.superflex;
    const thirdQbGain = three.roster.components.superflex - two.roster.components.superflex;

    expect(thirdQbGain).toBeGreaterThan(0);
    expect(thirdQbGain).toBeLessThan(secondQbGain);
  });

  it('calls out the structural hole in the verdict for a one-QB roster', () => {
    const one = gradeOf(
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      )
    );
    expect(one.rosterVerdict).toContain('starts two');
  });

  it('never exceeds the component ceiling on either grade', () => {
    const g = gradeOf(BALANCED);

    for (const [key, weight] of Object.entries(ROSTER_WEIGHTS)) {
      const v = g.roster.components[key as keyof typeof ROSTER_WEIGHTS];
      expect(v).toBeLessThanOrEqual(weight);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    for (const [key, weight] of Object.entries(DRAFT_WEIGHTS)) {
      const v = g.draft.components[key as keyof typeof DRAFT_WEIGHTS];
      expect(v).toBeLessThanOrEqual(weight);
      expect(v).toBeGreaterThanOrEqual(0);
    }

    expect(g.roster.score).toBeLessThanOrEqual(100);
    expect(g.draft.score).toBeLessThanOrEqual(100);
  });
});

describe('gradeDraft — byes, construction and keepers', () => {
  function gradeOf(spec: typeof BALANCED) {
    const { picks, players, ranks } = buildTeam('a', spec);
    return gradeDraft({
      picks,
      owners: [owner('a')],
      ...withPool(players, ranks),
    })[0];
  }

  it('deducts for four or more starters sharing a bye', () => {
    const spread = gradeOf(BALANCED.map((s, i) => ({ ...s, bye: 5 + (i % 8) })));
    const stacked = gradeOf(BALANCED.map((s) => ({ ...s, bye: 9 })));

    // Byes are a roster-side component: full marks when spread, docked when stacked.
    expect(stacked.roster.components.byes).toBeLessThan(spread.roster.components.byes);
    expect(stacked.byeCollision?.count).toBeGreaterThanOrEqual(4);
    expect(spread.roster.components.byes).toBe(ROSTER_WEIGHTS.byes);
  });

  it('penalizes a wasted second DEF — only one can ever start', () => {
    const one = gradeOf(BALANCED);
    const two = gradeOf(
      BALANCED.map((s) =>
        s.name === 'WR E' ? { ...s, name: 'DEF B', pos: 'DEF' as const } : s
      )
    );
    expect(two.roster.components.depth).toBeLessThan(one.roster.components.depth);
  });

  it('credits a keeper kept well below its market round', () => {
    const noKeeper = gradeOf(BALANCED);
    const cheapKeeper = gradeOf(
      BALANCED.map((s) => (s.name === 'RB A' ? { ...s, keeperRound: 12 } : s))
    );
    expect(cheapKeeper.draft.components.keeper).toBeGreaterThan(noKeeper.draft.components.keeper);
  });

  it('ranks teams by score, best first', () => {
    const strong = buildTeam('strong', BALANCED, 1);
    const weak = buildTeam(
      'weak',
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      ),
      2
    );

    const grades = gradeDraft({
      picks: [...strong.picks, ...weak.picks],
      owners: [owner('strong'), owner('weak')],
      ...withPool(
        [...strong.players, ...weak.players],
        { ...strong.ranks, ...weak.ranks }
      ),
    });

    expect(grades).toHaveLength(2);
    expect(grades[0].roster.rank).toBe(1);
    expect(grades[0].roster.score).toBeGreaterThanOrEqual(grades[1].roster.score);
    expect(grades[0].ownerId).toBe('strong');
  });
});

describe('gradeDraft — value is measured against the board, not the pick number', () => {
  /**
   * The regression this locks down: with 60 keeper slots pre-filled, comparing
   * a player's rank to their overall pick number made every team score 0 for
   * value. Value has to be counted against who was actually still available.
   */
  function twoTeamDraft(opts: { keeperElites: boolean }) {
    const players: Player[] = [];
    const ranks: Record<string, RankEntry> = {};
    const picks: DraftPick[] = [];

    // 40 ranked players in the universe.
    for (let i = 1; i <= 40; i++) {
      const p = player(`P${i}`, i % 4 === 0 ? 'RB' : 'WR', i);
      players.push(p);
      ranks[p.espn_id as string] = { rank: i, adp: null };
    }

    // The 20 best are keepers on team 'k' — off the board before pick 1.
    if (opts.keeperElites) {
      players.slice(0, 20).forEach((p, i) => {
        picks.push({
          id: 1000 + i, season_id: 1, round: 1, pick_in_round: 1,
          overall_pick: 1000 + i,
          original_owner_id: 'k', current_owner_id: 'k', player_id: p.id,
          is_keeper: true, keeper_year: 1, picked_at: null,
          is_auto_pick: false, created_at: '',
        } as DraftPick);
      });
    }

    // Team 'a' then takes the best available every time.
    const start = opts.keeperElites ? 20 : 0;
    players.slice(start, start + 10).forEach((p, i) => {
      picks.push({
        id: i + 1, season_id: 1, round: i + 1, pick_in_round: 1,
        overall_pick: i + 1,
        original_owner_id: 'a', current_owner_id: 'a', player_id: p.id,
        is_keeper: false, keeper_year: null, picked_at: null,
        is_auto_pick: false, created_at: '',
      } as DraftPick);
    });

    return gradeDraft({
      picks,
      owners: [owner('a'), owner('k')],
      playerMap: new Map(players.map((p) => [p.id, p])),
      ranks,
    }).find((g) => g.ownerId === 'a')!;
  }

  it('gives full value credit for taking best available, keepers or not', () => {
    const noKeepers = twoTeamDraft({ keeperElites: false });
    const withKeepers = twoTeamDraft({ keeperElites: true });

    expect(noKeepers.draft.components.value).toBe(DRAFT_WEIGHTS.value);
    // The regression: elite keepers must not drag this to zero.
    expect(withKeepers.draft.components.value).toBe(DRAFT_WEIGHTS.value);
  });

  it('reports best available as zero players passed over', () => {
    const g = twoTeamDraft({ keeperElites: true });
    expect(g.bestValue?.passedOver).toBe(0);
  });

  it('rewards taking the best at your position and docks taking the worst', () => {
    // Built explicitly rather than from the shared fixture: this needs a team
    // that genuinely takes the top of a position and one that genuinely takes
    // the bottom, which the shared roster template can't express.
    function draftFrom(order: 'best' | 'worst') {
      const players: Player[] = [];
      const ranks: Record<string, RankEntry> = {};
      for (let i = 1; i <= 40; i++) {
        const p = player(`WR${i}`, 'WR', i);
        players.push(p);
        ranks[p.espn_id as string] = { rank: i, adp: null };
      }
      const chosen =
        order === 'best' ? [players[0], players[1], players[2]]
        : [players[37], players[38], players[39]];

      const picks = chosen.map((p, i) => ({
        id: i + 1, season_id: 1, round: i + 1, pick_in_round: 1,
        overall_pick: i + 1,
        original_owner_id: 'a', current_owner_id: 'a', player_id: p.id,
        is_keeper: false, keeper_year: null, picked_at: null,
        is_auto_pick: false, created_at: '',
      })) as DraftPick[];

      return gradeDraft({
        picks,
        owners: [owner('a')],
        playerMap: new Map(players.map((p) => [p.id, p])),
        ranks,
      })[0];
    }

    const best = draftFrom('best');
    const worst = draftFrom('worst');

    // Taking the top of the position leaves nothing on the table.
    expect(best.bestValue?.shortfall).toBe(0);
    expect(worst.biggestReach?.shortfall ?? 0).toBeGreaterThan(0.5);
    expect(best.draft.components.value).toBeGreaterThan(
      worst.draft.components.value
    );
  });
});

describe('gradeDraft — the two grades measure different things', () => {
  /**
   * The reason the grades are split at all: a team can own the best roster in
   * the league off a mediocre draft, because elite keepers did the work and
   * keepers are excluded from the draft grade.
   */
  it('separates a keeper-built roster from the draft that followed it', () => {
    const players: Player[] = [];
    const ranks: Record<string, RankEntry> = {};
    const picks: DraftPick[] = [];

    for (let i = 1; i <= 60; i++) {
      const pos: Player['position'] =
        i <= 4 ? 'QB' : i <= 20 ? 'RB' : i <= 40 ? 'WR' : i <= 55 ? 'TE' : 'DEF';
      const p = player(`P${i}`, pos, i);
      players.push(p);
      ranks[p.espn_id as string] = { rank: i, adp: null };
    }

    // Team 'keeper' holds the four best players as cheap round-12 keepers,
    // then drafts poorly: every live pick is the worst player left at that
    // position, which is what board value now measures.
    players.slice(0, 4).forEach((p, i) => {
      picks.push({
        id: 500 + i, season_id: 1, round: 12, pick_in_round: 1,
        overall_pick: 500 + i,
        original_owner_id: 'keeper', current_owner_id: 'keeper', player_id: p.id,
        is_keeper: true, keeper_year: 1, picked_at: null,
        is_auto_pick: false, created_at: '',
      } as DraftPick);
    });
    [59, 58, 57, 56].forEach((idx, i) => {
      picks.push({
        id: 600 + i, season_id: 1, round: i + 1, pick_in_round: 1,
        overall_pick: 600 + i,
        original_owner_id: 'keeper', current_owner_id: 'keeper',
        player_id: players[idx].id,
        is_keeper: false, keeper_year: null, picked_at: null,
        is_auto_pick: false, created_at: '',
      } as DraftPick);
    });

    const grades = gradeDraft({
      picks,
      owners: [owner('keeper')],
      playerMap: new Map(players.map((p) => [p.id, p])),
      ranks,
    });

    const g = grades[0];
    // Elite keepers carry the roster; the draft itself was poor.
    expect(g.roster.components.lineup).toBeGreaterThan(0);
    expect(g.draft.components.keeper).toBeGreaterThan(0);
    // Keepers carry the roster; the live picks were poor, so board value sits
    // below a full score even though the keepers were excellent.
    expect(g.draft.components.value).toBeLessThan(DRAFT_WEIGHTS.value);
    // Keepers are excluded from the draft's board-value measure entirely.
    expect(g.keeperCount).toBe(4);
    expect(g.bestValue?.pick.is_keeper).toBe(false);
  });

  it('ranks each grade independently', () => {
    const a = buildTeam('a', BALANCED, 1);
    const b = buildTeam(
      'b',
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      ),
      2
    );

    const grades = gradeDraft({
      picks: [...a.picks, ...b.picks],
      owners: [owner('a'), owner('b')],
      ...withPool([...a.players, ...b.players], { ...a.ranks, ...b.ranks }),
    });

    const draftRanks = grades.map((g) => g.draft.rank).sort();
    const rosterRanks = grades.map((g) => g.roster.rank).sort();
    expect(draftRanks).toEqual([1, 2]);
    expect(rosterRanks).toEqual([1, 2]);
  });

  it('gives every team both a draft and a roster verdict', () => {
    const { picks, players, ranks } = buildTeam('a', BALANCED);
    const g = gradeDraft({
      picks,
      owners: [owner('a')],
      ...withPool(players, ranks),
    })[0];

    expect(g.draftVerdict.length).toBeGreaterThan(0);
    expect(g.rosterVerdict.length).toBeGreaterThan(0);
    expect(g.draftVerdict).not.toBe(g.rosterVerdict);
  });
});

describe('curveScores — live grades during the draft', () => {
  it('centres an average team at B', () => {
    const curved = curveScores([50, 60, 70, 80, 90]);
    const middle = curved[2];
    expect(middle.letter).toBe('B');
    expect(Math.abs(middle.z)).toBeLessThan(0.15);
  });

  it('gives the outlier the top letter and the laggard the bottom', () => {
    const curved = curveScores([20, 60, 62, 64, 66]);
    const worst = curved[0];
    expect(worst.rank).toBe(5);
    expect(worst.letter).toBe('D');
    expect(curved[4].rank).toBe(1);
    expect(curved[4].z).toBeGreaterThan(0);
  });

  it('refuses to manufacture a spread when the field is tied', () => {
    // The state of the board for the first couple of rounds: everyone level.
    const curved = curveScores([60, 60, 60, 60]);
    expect(curved.every((c) => c.bunched)).toBe(true);
    expect(curved.every((c) => c.letter === 'B−')).toBe(true);
    expect(curved.every((c) => c.z === 0)).toBe(true);
  });

  it('treats a near-tied field as bunched rather than ranking noise', () => {
    const curved = curveScores([60, 60.2, 60.4, 60.1]);
    expect(curved.every((c) => c.bunched)).toBe(true);
  });

  it('still ranks every team even when bunched', () => {
    const curved = curveScores([60, 60.4, 60.2, 60.1]);
    expect([...curved.map((c) => c.rank)].sort()).toEqual([1, 2, 3, 4]);
    expect(curved[1].rank).toBe(1);
  });

  it('handles an empty and a single-team field', () => {
    expect(curveScores([])).toEqual([]);
    const one = curveScores([70]);
    expect(one).toHaveLength(1);
    expect(one[0].rank).toBe(1);
    expect(one[0].bunched).toBe(true);
  });

  it('attaches a curve to every team from gradeDraft', () => {
    const a = buildTeam('a', BALANCED, 1);
    const b = buildTeam(
      'b',
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      ),
      2
    );

    const grades = gradeDraft({
      picks: [...a.picks, ...b.picks],
      owners: [owner('a'), owner('b')],
      ...withPool([...a.players, ...b.players], { ...a.ranks, ...b.ranks }),
    });

    for (const g of grades) {
      expect(g.curve.roster.letter).toBeTruthy();
      expect(g.curve.draft.letter).toBeTruthy();
      expect(g.curve.roster.rank).toBeGreaterThanOrEqual(1);
    }
    // The two-QB team must curve above the one-QB team on roster.
    const strong = grades.find((g) => g.ownerId === 'a')!;
    const weak = grades.find((g) => g.ownerId === 'b')!;
    expect(strong.curve.roster.rank).toBeLessThan(weak.curve.roster.rank);
  });
});

describe('displayGrade — one scale everywhere', () => {
  /**
   * The regression this locks down: the board, the roster columns and the
   * grades table each chose their own letter. The board stayed on the curve
   * while the table switched to absolute the moment the draft completed, so the
   * same team read A− in one place and C in another.
   */
  function twoTeams() {
    const a = buildTeam('a', BALANCED, 1);
    const b = buildTeam(
      'b',
      BALANCED.map((s) =>
        s.name === 'QB B' ? { ...s, name: 'WR F', pos: 'WR' as const } : s
      ),
      2
    );
    return gradeDraft({
      picks: [...a.picks, ...b.picks],
      owners: [owner('a'), owner('b')],
      ...withPool([...a.players, ...b.players], { ...a.ranks, ...b.ranks }),
    });
  }

  it('returns the curved letter while the draft is running', () => {
    for (const g of twoTeams()) {
      const shown = displayGrade(g, 'roster', false);
      expect(shown.curved).toBe(true);
      expect(shown.letter).toBe(g.curve.roster.letter);
      expect(shown.rank).toBe(g.curve.roster.rank);
    }
  });

  it('returns the absolute letter once the draft is complete', () => {
    for (const g of twoTeams()) {
      const shown = displayGrade(g, 'roster', true);
      expect(shown.curved).toBe(false);
      expect(shown.letter).toBe(g.roster.letter);
      expect(shown.rank).toBe(g.roster.rank);
    }
  });

  it('gives the same answer for the same inputs, every call site', () => {
    const [g] = twoTeams();
    for (const complete of [true, false]) {
      const board = displayGrade(g, 'roster', complete);
      const column = displayGrade(g, 'roster', complete);
      const table = displayGrade(g, 'roster', complete);
      expect(board).toEqual(column);
      expect(column).toEqual(table);
    }
  });

  it('always reports the absolute score, whichever letter is shown', () => {
    const [g] = twoTeams();
    expect(displayGrade(g, 'roster', false).score).toBe(g.roster.score);
    expect(displayGrade(g, 'roster', true).score).toBe(g.roster.score);
    expect(displayGrade(g, 'draft', false).score).toBe(g.draft.score);
  });

  it('covers the draft grade as well as the roster grade', () => {
    const [g] = twoTeams();
    expect(displayGrade(g, 'draft', false).letter).toBe(g.curve.draft.letter);
    expect(displayGrade(g, 'draft', true).letter).toBe(g.draft.letter);
  });
});

describe('gradeDraft — degraded inputs', () => {
  it('still grades when ESPN ranks are missing entirely', () => {
    const { picks, players } = buildTeam('a', BALANCED);
    const grades = gradeDraft({
      picks,
      owners: [owner('a')],
      playerMap: new Map(players.map((p) => [p.id, p])),
      ranks: {},
    });

    expect(grades).toHaveLength(1);
    expect(Number.isFinite(grades[0].roster.score)).toBe(true);
    expect(Number.isFinite(grades[0].draft.score)).toBe(true);
    // Everyone is replacement level, so lineup and value collapse — but the
    // roster-shape components still register.
    expect(grades[0].roster.components.depth).toBeGreaterThan(0);
  });

  it('ignores unfilled pick slots', () => {
    const { picks, players, ranks } = buildTeam('a', BALANCED);
    const empty = { ...picks[0], id: 999, overall_pick: 999, player_id: null };

    const grades = gradeDraft({
      picks: [...picks, empty as DraftPick],
      owners: [owner('a')],
      playerMap: new Map(players.map((p) => [p.id, p])),
      ranks,
    });
    expect(grades[0].counts.QB).toBe(2);
  });

  it('returns nothing when no picks have been made', () => {
    expect(
      gradeDraft({ picks: [], owners: [owner('a')], playerMap: new Map(), ranks: {} })
    ).toEqual([]);
  });

  it('credits a traded pick to the owner who holds it now', () => {
    const { picks, players, ranks } = buildTeam('a', BALANCED);
    picks[0] = { ...picks[0], current_owner_id: 'b' };

    const grades = gradeDraft({
      picks,
      owners: [owner('a'), owner('b')],
      playerMap: new Map(players.map((p) => [p.id, p])),
      ranks,
    });

    const b = grades.find((g) => g.ownerId === 'b');
    expect(b?.counts.QB).toBe(1);
    expect(grades.find((g) => g.ownerId === 'a')?.counts.QB).toBe(1);
  });
});
