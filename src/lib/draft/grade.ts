import type { DraftPick, Owner, Player } from '@/types/database';
import { LEAGUE_CONFIG } from '@/types/database';

/**
 * Two separate grades, because they answer two different questions.
 *
 * DRAFT grades the process: given the board actually in front of you at each
 * pick, did you make good decisions? Keepers are excluded — you didn't draft
 * them — but the round-cost surplus you locked in by keeping them is a real
 * pre-draft decision, so keeper leverage lives here.
 *
 * ROSTER grades the outcome: how good is the team you now own, regardless of
 * how it got assembled? Keepers count fully, because they're on the roster.
 *
 * The two come apart in the interesting cases. A team with cheap elite keepers
 * can own the best roster off an average draft; a team picking from a bad slot
 * can draft superbly and still be thin. A single blended score hides both.
 *
 * Weights are league-specific on purpose. A generic grader scores "did you take
 * the best player available", which in this format gets the answer wrong: 12
 * teams each start a QB *and* a superflex, so 24 of roughly 32 startable NFL
 * quarterbacks are locked into lineups every week. A roster leaving the draft
 * with one QB is a nine-slot lineup with eight players, however good those
 * eight are.
 *
 * Everything derives from data already on the page: picks (round, keeper flag),
 * players (position, bye week), and the ESPN superflex ranks the player pool
 * already loads. No new data source, no migration.
 */

export const DRAFT_WEIGHTS = {
  value: 60,
  keeper: 25,
  discipline: 15,
} as const;

export const ROSTER_WEIGHTS = {
  lineup: 45,
  superflex: 30,
  depth: 20,
  byes: 5,
} as const;

export type DraftComponent = keyof typeof DRAFT_WEIGHTS;
export type RosterComponent = keyof typeof ROSTER_WEIGHTS;

/** Starters: QB, RB, RB, WR, WR, TE, FLEX, SF, DEF. */
const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE'];

/** Ranks worse than this are treated as replacement level. */
const REPLACEMENT_RANK = 200;

/** Mean players passed over at which board discipline scores zero. */
const PASSED_OVER_FLOOR = 30;

/** Worst single reach at which the discipline component scores zero. */
const WORST_REACH_FLOOR = 50;

export interface RankEntry {
  rank: number;
  adp: number | null;
}

export interface GradedPick {
  player: Player;
  pick: DraftPick;
  /** ESPN superflex rank, or null when the player is unranked. */
  rank: number | null;
  /**
   * Better-ranked players still on the board when this pick was made. 0 means
   * best available. Null for keepers — a keeper costs a round, not a slot.
   *
   * This replaces the obvious "rank minus pick number", which is unusable here:
   * 60 of the 180 slots are pre-filled keepers and keepers skew elite, so the
   * best available player is always ranked far worse than the pick number. That
   * made every team look like it reached on every pick.
   */
  passedOver: number | null;
}

export interface ScoreBlock<C extends string> {
  score: number;
  letter: string;
  rank: number;
  components: Record<C, number>;
}

/**
 * A grade relative to the rest of the league right now, rather than against a
 * fixed scale. Mid-draft every absolute score is low — nobody has a full roster
 * at pick 40 — so an absolute letter reads as "everyone is failing" when what
 * an owner actually wants to know is "am I ahead of the room".
 */
export interface CurvedGrade {
  /** Standard deviations from the league mean. 0 is exactly average. */
  z: number;
  letter: string;
  rank: number;
  /** True when the field is too tightly bunched for the spread to mean much. */
  bunched: boolean;
}

export interface TeamGrade {
  ownerId: string;
  ownerName: string;
  teamName: string;
  draft: ScoreBlock<DraftComponent>;
  roster: ScoreBlock<RosterComponent>;
  /** Live, league-relative letters — the ones to show during the draft. */
  curve: { draft: CurvedGrade; roster: CurvedGrade };
  /** Quarterbacks on the roster, best rank first. */
  qbRoom: Player[];
  starters: { slot: string; player: Player | null }[];
  bestValue: GradedPick | null;
  biggestReach: GradedPick | null;
  keeperCount: number;
  /** Worst bye-week collision among starters. */
  byeCollision: { week: number; count: number } | null;
  counts: Record<string, number>;
  draftVerdict: string;
  rosterVerdict: string;
}

function rankOf(player: Player, ranks: Record<string, RankEntry>): number | null {
  if (!player.espn_id) return null;
  const entry = ranks[player.espn_id];
  return entry && entry.rank > 0 ? entry.rank : null;
}

function effectiveRank(player: Player, ranks: Record<string, RankEntry>): number {
  return rankOf(player, ranks) ?? REPLACEMENT_RANK;
}

/**
 * Rank → 0..1 quality. Rank 1 scores 1.0 and decays to 0 at replacement level.
 * Sub-linear so the gap between the 1st and 10th player matters more than the
 * gap between the 100th and 110th, which is how lineups actually behave.
 */
function quality(rank: number): number {
  if (rank >= REPLACEMENT_RANK) return 0;
  return 1 - Math.pow(rank / REPLACEMENT_RANK, 0.6);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Fill the nine starting slots greedily, best player first, hardest slot first.
 * DEF and TE are filled before the flexes because nothing else can cover them.
 */
export function pickStarters(
  roster: { player: Player; rank: number }[]
): { slot: string; player: Player | null }[] {
  const pool = [...roster].sort((a, b) => a.rank - b.rank);
  const taken = new Set<number>();

  const take = (eligible: string[]) => {
    const found = pool.find(
      (e) => !taken.has(e.player.id) && eligible.includes(e.player.position)
    );
    if (found) taken.add(found.player.id);
    return found?.player ?? null;
  };

  const def = take(['DEF']);
  const qb = take(['QB']);
  const te = take(['TE']);
  const rb1 = take(['RB']);
  const rb2 = take(['RB']);
  const wr1 = take(['WR']);
  const wr2 = take(['WR']);
  const flex = take(FLEX_ELIGIBLE);
  const sf = take(SUPERFLEX_ELIGIBLE);

  return [
    { slot: 'QB', player: qb },
    { slot: 'RB', player: rb1 },
    { slot: 'RB', player: rb2 },
    { slot: 'WR', player: wr1 },
    { slot: 'WR', player: wr2 },
    { slot: 'TE', player: te },
    { slot: 'FLEX', player: flex },
    { slot: 'SF', player: sf },
    { slot: 'DEF', player: def },
  ];
}

// ---------------------------------------------------------------- roster side

function scoreLineup(
  starters: { slot: string; player: Player | null }[],
  ranks: Record<string, RankEntry>
): number {
  const scores = starters.map((s) =>
    s.player ? quality(effectiveRank(s.player, ranks)) : 0
  );
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return round1(mean * ROSTER_WEIGHTS.lineup);
}

/**
 * Two startable quarterbacks is the baseline the format demands; the third is
 * trade capital, and one is a structural hole no amount of skill talent covers.
 */
function scoreSuperflex(qbs: { player: Player; rank: number }[]): number {
  if (qbs.length === 0) return 0;
  const sorted = [...qbs].sort((a, b) => a.rank - b.rank);
  const q1 = quality(sorted[0].rank);
  const q2 = sorted[1] ? quality(sorted[1].rank) : 0;
  const q3 = sorted[2] ? quality(sorted[2].rank) : 0;
  // 45% first starter, 40% second starter, 15% depth/trade capital.
  return round1((q1 * 0.45 + q2 * 0.4 + q3 * 0.15) * ROSTER_WEIGHTS.superflex);
}

/**
 * Rewards the RB/WR bodies that cover FLEX and bye weeks, and penalizes picks
 * spent on a second DEF or third TE — there is one slot each, so the extras can
 * never enter a lineup.
 */
function scoreDepth(counts: Record<string, number>): number {
  const rb = counts.RB ?? 0;
  const wr = counts.WR ?? 0;
  const te = counts.TE ?? 0;
  const def = counts.DEF ?? 0;

  const rbScore = Math.min(1, rb / 5);
  const wrScore = Math.min(1, wr / 5);
  let raw = (rbScore + wrScore) / 2;

  const wasted = Math.max(0, te - 2) + Math.max(0, def - 1);
  raw -= wasted * 0.12;

  return round1(Math.max(0, Math.min(1, raw)) * ROSTER_WEIGHTS.depth);
}

/** Bye resilience. Up to three starters sharing a week is unavoidable; more isn't. */
function scoreByes(collision: { week: number; count: number } | null): number {
  if (!collision) return ROSTER_WEIGHTS.byes;
  const over = Math.max(0, collision.count - 3);
  return round1(Math.max(0, 1 - over / 4) * ROSTER_WEIGHTS.byes);
}

// ----------------------------------------------------------------- draft side

/**
 * How close each live pick came to the best player actually available.
 * Scored on players passed over — see GradedPick.passedOver for why rank-minus-
 * pick is meaningless in a keeper format.
 */
function scoreValue(graded: GradedPick[]): number {
  const live = graded.filter((g) => g.passedOver !== null);
  // No ranks at all — award par rather than punishing a data outage.
  if (live.length === 0) return round1(DRAFT_WEIGHTS.value * 0.5);

  const mean =
    live.reduce((a, g) => a + (g.passedOver as number), 0) / live.length;
  return round1(Math.max(0, 1 - mean / PASSED_OVER_FLOOR) * DRAFT_WEIGHTS.value);
}

/**
 * Keeper leverage: market rank against round cost. A top-12 player kept at a
 * round-10 price is the cheapest edge in the league, and it renews annually.
 */
function scoreKeeper(
  keepers: { player: Player; rank: number; round: number }[]
): number {
  if (keepers.length === 0) return 0;

  const surplus = keepers.reduce((total, k) => {
    const roundValue = (k.round - 1) * LEAGUE_CONFIG.NUM_TEAMS + 1;
    return total + Math.max(0, roundValue - k.rank);
  }, 0);

  // ~180 slots of surplus across a full keeper slate is an excellent haul.
  return round1(Math.min(1, surplus / 180) * DRAFT_WEIGHTS.keeper);
}

/**
 * Worst single pick, separate from the average. A team can post a good mean and
 * still have torched one pick badly; averaging alone would bury that.
 */
function scoreDiscipline(graded: GradedPick[]): number {
  const live = graded.filter((g) => g.passedOver !== null);
  if (live.length === 0) return round1(DRAFT_WEIGHTS.discipline * 0.5);

  const worst = Math.max(...live.map((g) => g.passedOver as number));
  return round1(
    Math.max(0, 1 - worst / WORST_REACH_FLOOR) * DRAFT_WEIGHTS.discipline
  );
}

// --------------------------------------------------------------------- shared

/**
 * Curve a set of scores against their own mean.
 *
 * Deliberately z-based rather than rank-based. A fixed rank ladder ("1st gets
 * an A+") would manufacture a spread even when all twelve teams are within a
 * point of each other, which is exactly the state of the board for the first
 * few rounds. Using standard deviations keeps a bunched field near B and only
 * hands out an A+ to a genuine outlier.
 */
export function curveScores(scores: number[]): CurvedGrade[] {
  const n = scores.length;
  if (n === 0) return [];

  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance =
    scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);

  // Ranks by score, best first. Ties share the better rank.
  const order = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s);
  const rankOfIndex = new Map<number, number>();
  order.forEach((e, i) => rankOfIndex.set(e.i, i + 1));

  // Below this the field is effectively tied and a curve is noise.
  const bunched = stdev < 1;

  return scores.map((s, i) => {
    const z = bunched ? 0 : (s - mean) / stdev;
    return {
      z: Math.round(z * 100) / 100,
      letter: bunched ? 'B−' : letterForZ(z),
      rank: rankOfIndex.get(i) as number,
      bunched,
    };
  });
}

function letterForZ(z: number): string {
  if (z >= 1.5) return 'A+';
  if (z >= 1.0) return 'A';
  if (z >= 0.6) return 'A−';
  if (z >= 0.3) return 'B+';
  if (z >= -0.15) return 'B';
  if (z >= -0.4) return 'B−';
  if (z >= -0.8) return 'C+';
  if (z >= -1.2) return 'C';
  if (z >= -1.6) return 'C−';
  return 'D';
}

function letterFor(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A−';
  if (score >= 76) return 'B+';
  if (score >= 72) return 'B';
  if (score >= 68) return 'B−';
  if (score >= 64) return 'C+';
  if (score >= 58) return 'C';
  if (score >= 52) return 'C−';
  return 'D';
}

function draftVerdictFor(
  components: Record<DraftComponent, number>,
  bestValue: GradedPick | null,
  biggestReach: GradedPick | null,
  keeperCount: number
): string {
  const parts: string[] = [];
  const pct = (c: DraftComponent) => components[c] / DRAFT_WEIGHTS[c];

  if (pct('value') > 0.75) {
    parts.push('Took close to the best player available almost every round.');
  } else if (pct('value') > 0.5) {
    parts.push('Drafted near the board without chasing it.');
  } else {
    parts.push('Repeatedly passed on better players still sitting there.');
  }

  if (bestValue?.passedOver === 0) {
    parts.push(`Best pick was ${bestValue.player.name}, the top name left.`);
  }

  if (pct('discipline') < 0.4 && biggestReach) {
    parts.push(
      `${biggestReach.player.name} was the outlier — ${biggestReach.passedOver} better players were still on the board.`
    );
  }

  if (keeperCount > 0) {
    if (pct('keeper') > 0.7) parts.push('The keepers were held at a steep discount.');
    else if (pct('keeper') < 0.3) parts.push('The keepers cost roughly what they were worth.');
  } else {
    parts.push('No keepers, so every slot had to be earned on the day.');
  }

  return parts.join(' ');
}

function rosterVerdictFor(
  qbCount: number,
  components: Record<RosterComponent, number>,
  byeCollision: { week: number; count: number } | null
): string {
  if (qbCount === 0) {
    return 'No quarterback at all. The lineup cannot be filled legally without a trade.';
  }
  if (qbCount === 1) {
    return 'One quarterback in a format that starts two — a structural deficit that shows up every week, not a bad matchup.';
  }

  const parts: string[] = [];
  const pct = (c: RosterComponent) => components[c] / ROSTER_WEIGHTS[c];

  if (qbCount >= 3 && pct('superflex') > 0.7) {
    parts.push('Three startable quarterbacks in a league that starts two — the scarcest asset here, held in surplus.');
  } else if (pct('superflex') > 0.7) {
    parts.push('The quarterback room covers both slots with a real ceiling.');
  } else {
    parts.push('Two quarterbacks, but neither one moves a week on its own.');
  }

  if (pct('lineup') > 0.7) parts.push('The starting nine is among the strongest in the league.');
  else if (pct('lineup') < 0.45) parts.push('The starting nine thins out fast past the top of it.');

  if (pct('depth') < 0.5) parts.push('Not enough bodies to cover FLEX and a bye in the same week.');

  if (byeCollision && byeCollision.count >= 4) {
    parts.push(`${byeCollision.count} starters share the week ${byeCollision.week} bye.`);
  }

  return parts.join(' ');
}

/**
 * Replay the draft in pick order and record, for each live pick, how many
 * better-ranked players were still on the board.
 *
 * Keepers are treated as off the board from the start — they were never
 * available to anyone — which is the whole reason this is computed by replay
 * rather than from the pick number.
 */
function computePassedOver(
  picks: DraftPick[],
  playerMap: Map<number, Player>,
  ranks: Record<string, RankEntry>
): Map<number, number> {
  const result = new Map<number, number>();

  const board = [...playerMap.values()]
    .map((p) => ({ id: p.id, rank: rankOf(p, ranks) }))
    .filter((e): e is { id: number; rank: number } => e.rank !== null)
    .sort((a, b) => a.rank - b.rank);

  if (board.length === 0) return result;

  const gone = new Set<number>();
  const live: DraftPick[] = [];

  for (const pick of picks) {
    if (pick.player_id === null) continue;
    if (pick.is_keeper) gone.add(pick.player_id);
    else live.push(pick);
  }

  live.sort((a, b) => a.overall_pick - b.overall_pick);

  for (const pick of live) {
    const player = playerMap.get(pick.player_id as number);
    const rank = player ? rankOf(player, ranks) : null;

    if (rank !== null) {
      let better = 0;
      for (const e of board) {
        if (e.rank >= rank) break; // sorted — nothing better remains
        if (!gone.has(e.id)) better++;
      }
      result.set(pick.id, better);
    }

    gone.add(pick.player_id as number);
  }

  return result;
}

export interface GradeInput {
  picks: DraftPick[];
  owners: Owner[];
  playerMap: Map<number, Player>;
  ranks: Record<string, RankEntry>;
}

export function gradeDraft({
  picks,
  owners,
  playerMap,
  ranks,
}: GradeInput): TeamGrade[] {
  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const byOwner = new Map<string, DraftPick[]>();

  for (const pick of picks) {
    if (pick.player_id === null) continue;
    const list = byOwner.get(pick.current_owner_id) ?? [];
    list.push(pick);
    byOwner.set(pick.current_owner_id, list);
  }

  const passedOverByPick = computePassedOver(picks, playerMap, ranks);

  // Ranks and the curve both need the whole field, so they're filled in after
  // every team is built.
  type Draft = Omit<TeamGrade, 'draft' | 'roster' | 'curve'> & {
    draft: Omit<ScoreBlock<DraftComponent>, 'rank'>;
    roster: Omit<ScoreBlock<RosterComponent>, 'rank'>;
  };
  const built: Draft[] = [];

  for (const [ownerId, ownerPicks] of byOwner) {
    const owner = ownerMap.get(ownerId);
    if (!owner) continue;

    const roster: { player: Player; rank: number }[] = [];
    const gradedPicks: GradedPick[] = [];
    const keepers: { player: Player; rank: number; round: number }[] = [];
    const counts: Record<string, number> = {};

    for (const pick of ownerPicks) {
      const player = playerMap.get(pick.player_id as number);
      if (!player) continue;

      const rank = rankOf(player, ranks);
      const eff = rank ?? REPLACEMENT_RANK;

      roster.push({ player, rank: eff });
      counts[player.position] = (counts[player.position] ?? 0) + 1;

      if (pick.is_keeper) {
        keepers.push({ player, rank: eff, round: pick.round });
        gradedPicks.push({ player, pick, rank, passedOver: null });
      } else {
        gradedPicks.push({
          player,
          pick,
          rank,
          passedOver: passedOverByPick.get(pick.id) ?? null,
        });
      }
    }

    const starters = pickStarters(roster);
    const qbs = roster.filter((e) => e.player.position === 'QB');

    // Bye collisions among starters only — bench byes cost nothing.
    const byeCounts = new Map<number, number>();
    for (const s of starters) {
      if (!s.player?.bye_week) continue;
      byeCounts.set(s.player.bye_week, (byeCounts.get(s.player.bye_week) ?? 0) + 1);
    }
    let byeCollision: { week: number; count: number } | null = null;
    for (const [week, count] of byeCounts) {
      if (!byeCollision || count > byeCollision.count) byeCollision = { week, count };
    }

    const rosterComponents: Record<RosterComponent, number> = {
      lineup: scoreLineup(starters, ranks),
      superflex: scoreSuperflex(qbs),
      depth: scoreDepth(counts),
      byes: scoreByes(byeCollision),
    };

    const draftComponents: Record<DraftComponent, number> = {
      value: scoreValue(gradedPicks),
      keeper: scoreKeeper(keepers),
      discipline: scoreDiscipline(gradedPicks),
    };

    const live = gradedPicks.filter((g) => g.passedOver !== null);
    const bestValue =
      live.length > 0
        ? live.reduce((a, b) => {
            const d = (a.passedOver as number) - (b.passedOver as number);
            if (d !== 0) return d > 0 ? b : a;
            return (b.rank ?? REPLACEMENT_RANK) < (a.rank ?? REPLACEMENT_RANK) ? b : a;
          })
        : null;
    const biggestReach =
      live.length > 0
        ? live.reduce((a, b) =>
            (b.passedOver as number) > (a.passedOver as number) ? b : a
          )
        : null;

    const draftScore = round1(
      Object.values(draftComponents).reduce((a, b) => a + b, 0)
    );
    const rosterScore = round1(
      Object.values(rosterComponents).reduce((a, b) => a + b, 0)
    );

    built.push({
      ownerId,
      ownerName: owner.name,
      teamName: owner.team_name,
      draft: {
        score: draftScore,
        letter: letterFor(draftScore),
        components: draftComponents,
      },
      roster: {
        score: rosterScore,
        letter: letterFor(rosterScore),
        components: rosterComponents,
      },
      qbRoom: qbs.sort((a, b) => a.rank - b.rank).map((e) => e.player),
      starters,
      bestValue,
      biggestReach,
      keeperCount: keepers.length,
      byeCollision,
      counts,
      draftVerdict: draftVerdictFor(
        draftComponents,
        bestValue,
        biggestReach,
        keepers.length
      ),
      rosterVerdict: rosterVerdictFor(qbs.length, rosterComponents, byeCollision),
    });
  }

  // Each grade is ranked independently — that divergence is the point.
  const draftOrder = [...built].sort((a, b) => b.draft.score - a.draft.score);
  const rosterOrder = [...built].sort((a, b) => b.roster.score - a.roster.score);

  const draftRank = new Map(draftOrder.map((g, i) => [g.ownerId, i + 1]));
  const rosterRank = new Map(rosterOrder.map((g, i) => [g.ownerId, i + 1]));

  // Curved against this league at this moment, so the letters stay meaningful
  // while the draft is still running and every absolute score is low.
  const draftCurve = curveScores(built.map((g) => g.draft.score));
  const rosterCurve = curveScores(built.map((g) => g.roster.score));

  return built
    .map((g, i) => ({
      ...g,
      draft: { ...g.draft, rank: draftRank.get(g.ownerId) as number },
      roster: { ...g.roster, rank: rosterRank.get(g.ownerId) as number },
      curve: { draft: draftCurve[i], roster: rosterCurve[i] },
    }))
    .sort((a, b) => a.roster.rank - b.roster.rank);
}
