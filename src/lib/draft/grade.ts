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

/**
 * Board value carries less than it looks like it should because almost everyone
 * takes the best player available *at the position they've chosen* — measured
 * across the real draft it ranged 84%-100%, so it barely separates anyone.
 * Keeper leverage is where the spread actually is (8%-90%), which is fitting in
 * a keeper league: what you chose to hold, and at what round cost, is the
 * decision with the longest tail.
 */
export const DRAFT_WEIGHTS = {
  value: 40,
  keeper: 35,
  discipline: 25,
} as const;

/**
 * Weights follow what actually separates rosters, measured over a real
 * completed draft rather than assumed.
 *
 * Depth falls from 20 to 8. Bench cover — the value of the three best players
 * not starting — came out at a median of exactly zero across the league: after
 * fifteen rounds with twelve teams, benches are replacement filler and there is
 * no signal there to weigh. It keeps a small weight so a genuinely stocked
 * bench still counts for something.
 *
 * Bye resilience rises from 5 to 12, having been the reverse mistake. Measured
 * as value sidelined in the worst week rather than a headcount it spans 1.2 to
 * 2.4 — a real two-fold spread that was being squeezed into five points.
 */
export const ROSTER_WEIGHTS = {
  lineup: 50,
  superflex: 30,
  depth: 8,
  byes: 12,
} as const;

export type DraftComponent = keyof typeof DRAFT_WEIGHTS;
export type RosterComponent = keyof typeof ROSTER_WEIGHTS;

/** Starters: QB, RB, RB, WR, WR, TE, FLEX, SF, DEF. */
const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE'];

/** Ranks worse than this are treated as replacement level. */
const REPLACEMENT_RANK = 200;

/**
 * How many of each position start league-wide in a given week: 12 teams times
 * the lineup, with FLEX and SF distributed across the positions that can fill
 * them. The Nth-best player at a position is therefore the last one starting
 * anywhere, which makes him replacement level — the bar a roster spot has to
 * clear to be worth anything at all.
 *
 * Grading against this rather than against overall rank is what stops every
 * roster scoring a C. A perfect score used to require nine rank-1 players,
 * which is unreachable when there is one rank-1 player and twelve teams; now it
 * requires the best startable player at each slot, which is merely very good.
 * It also removes a false penalty on defences and tight ends, who rank terribly
 * overall and so looked like reaches however early the position had to be
 * taken.
 */
const LEAGUE_STARTERS: Record<string, number> = {
  QB: 22, // 12 QB slots plus most superflexes
  RB: 29, // 24 RB slots plus roughly half the flexes
  WR: 29,
  TE: 14, // 12 TE slots plus the occasional flex
  DEF: 12,
};

/**
 * Bench cover (mean VORP of the three best non-starters) at which depth maxes
 * out. The best bench in a real completed draft reached 0.14, so this is set
 * just under it — most teams score zero here, which is the honest answer.
 */
const DEPTH_CEILING = 0.12;

/**
 * Value sidelined in the worst bye week. Roughly one average starter is
 * unavoidable; losing the equivalent of two and a half is a stacked bye that
 * costs real weeks. Measured range across the league was 1.2 to 2.4.
 */
const BYE_BEST_LOST = 1.0;
const BYE_WORST_LOST = 2.5;

/** Mean VORP left on the table per pick at which board value scores zero. */
const VALUE_SHORTFALL_FLOOR = 0.5;

/** Worst single pick's VORP shortfall at which discipline scores zero. */
const WORST_SHORTFALL_FLOOR = 0.85;

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
   * Better-ranked players still on the board when this pick was made. Kept for
   * display — "12 better left" reads more plainly than a VORP delta.
   */
  passedOver: number | null;
  /**
   * Value left on the table *at the position drafted*: the best available VORP
   * at that position minus the VORP actually taken. 0 means you took the best
   * one there.
   *
   * Deliberately position-relative. Measured across all positions instead, the
   * best available is a defence from round 3 onward — DEF#1 carries full VORP
   * and nobody drafts a defence until round 11 — so every legitimate skill pick
   * scored as a total reach and the whole component collapsed to zero. VORP
   * measures weekly lineup value, not draft-time opportunity cost.
   *
   * So this asks "having decided to take a receiver here, did you take the best
   * receiver available?". Whether a receiver was the right call at all is what
   * the roster grade answers, by punishing the shape you end up with.
   */
  shortfall: number | null;
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
 * Value over replacement, 0..1, for every ranked player.
 *
 * A player's worth is his rank *within his position* measured against the last
 * player at that position who starts anywhere in the league. The best QB scores
 * ~1, the 22nd QB scores 0, and everyone below him also scores 0 — a third
 * tight end contributes nothing because he can never enter a lineup.
 */
export type VorpTable = Map<number, number>;

export function buildVorpTable(
  playerMap: Map<number, Player>,
  ranks: Record<string, RankEntry>
): VorpTable {
  const byPosition = new Map<string, { id: number; rank: number }[]>();

  for (const player of playerMap.values()) {
    const rank = rankOf(player, ranks);
    if (rank === null) continue;
    const list = byPosition.get(player.position) ?? [];
    list.push({ id: player.id, rank });
    byPosition.set(player.position, list);
  }

  const table: VorpTable = new Map();

  for (const [position, list] of byPosition) {
    list.sort((a, b) => a.rank - b.rank);
    const replacement = LEAGUE_STARTERS[position] ?? 12;

    list.forEach((entry, i) => {
      const posRank = i + 1;
      // Linear from the top of the position down to replacement level. Linear
      // rather than curved because the drop from QB1 to QB12 really is close to
      // even in a superflex format — the scarcity is already priced in by
      // measuring against replacement.
      const v = (replacement - posRank) / (replacement - 1);
      table.set(entry.id, Math.max(0, Math.min(1, v)));
    });
  }

  return table;
}

function vorpOf(player: Player | null | undefined, vorp: VorpTable): number {
  if (!player) return 0;
  return vorp.get(player.id) ?? 0;
}

/**
 * The best lineup and quarterback room any single team in this league could
 * actually own, used as the 100% mark.
 *
 * Without this the scale is anchored to a perfect-VORP roster, which is not
 * merely hard but arithmetically impossible: twelve teams share one player pool,
 * so nobody fields the best player at all nine slots and every roster scored a
 * C. Anchoring to the achievable ceiling makes 100 mean "the best roster this
 * league could produce" — still unreachable in practice, but in the same
 * universe as the rosters being graded.
 *
 * Computed from the player pool alone, not from how the other eleven teams
 * actually did, so it is an absolute scale and not a second curve.
 */
function achievableCeilings(
  playerMap: Map<number, Player>,
  vorp: VorpTable
): { lineup: number; superflex: number } {
  const byPos = new Map<string, number[]>();
  for (const p of playerMap.values()) {
    const v = vorp.get(p.id);
    if (v === undefined) continue;
    const list = byPos.get(p.position) ?? [];
    list.push(v);
    byPos.set(p.position, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => b - a);

  const top = (pos: string, n: number) => (byPos.get(pos) ?? [])[n - 1] ?? 0;

  // One team taking the best at every slot: QB1, RB1-2, WR1-2, TE1, the best
  // remaining flex, QB2 in the superflex, DEF1.
  const flexBest = Math.max(top('RB', 3), top('WR', 3), top('TE', 2));
  const lineupSlots = [
    top('QB', 1), top('RB', 1), top('RB', 2), top('WR', 1), top('WR', 2),
    top('TE', 1), flexBest, top('QB', 2), top('DEF', 1),
  ];
  const lineup = lineupSlots.reduce((a, b) => a + b, 0) / lineupSlots.length;

  const superflex =
    top('QB', 1) * 0.45 + top('QB', 2) * 0.4 + top('QB', 3) * 0.15;

  // Guard against a rank outage leaving the ceiling at zero.
  return { lineup: lineup || 1, superflex: superflex || 1 };
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
  vorp: VorpTable,
  ceiling: number
): number {
  const scores = starters.map((s) => vorpOf(s.player, vorp));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return round1(Math.min(1, mean / ceiling) * ROSTER_WEIGHTS.lineup);
}

/**
 * Two startable quarterbacks is the baseline the format demands; the third is
 * trade capital, and one is a structural hole no amount of skill talent covers.
 */
function scoreSuperflex(
  qbs: { player: Player; rank: number }[],
  vorp: VorpTable,
  ceiling: number
): number {
  if (qbs.length === 0) return 0;
  const sorted = [...qbs].sort((a, b) => a.rank - b.rank);
  const q1 = vorpOf(sorted[0]?.player, vorp);
  const q2 = vorpOf(sorted[1]?.player, vorp);
  const q3 = vorpOf(sorted[2]?.player, vorp);
  // 45% first starter, 40% second starter, 15% depth/trade capital.
  const raw = q1 * 0.45 + q2 * 0.4 + q3 * 0.15;
  return round1(Math.min(1, raw / ceiling) * ROSTER_WEIGHTS.superflex);
}

/**
 * Bench strength: what the roster can actually put on the field when a starter
 * is on bye or hurt.
 *
 * Counting bodies instead — five RBs and five WRs — scored 16-20 out of 20 for
 * every team in a completed draft, because after fifteen rounds everybody has
 * five of each. It spent a fifth of the scale on no signal at all. What
 * separates benches is whether the next man up is startable or is replacement
 * filler, so this reads the three best players not already starting.
 */
const DEPTH_COVER = 3;

function scoreDepth(
  roster: { player: Player }[],
  starters: { slot: string; player: Player | null }[],
  counts: Record<string, number>,
  vorp: VorpTable
): number {
  const starting = new Set(
    starters.map((s) => s.player?.id).filter((id): id is number => id != null)
  );

  const bench = roster
    .filter((e) => !starting.has(e.player.id))
    .map((e) => vorpOf(e.player, vorp))
    .sort((a, b) => b - a);

  // Always divided by DEPTH_COVER, so a short bench is penalised rather than
  // flattered by averaging over fewer players.
  const cover =
    bench.slice(0, DEPTH_COVER).reduce((a, b) => a + b, 0) / DEPTH_COVER;

  // Roster spots that can never enter a lineup are still dead weight.
  const wasted =
    Math.max(0, (counts.TE ?? 0) - 2) + Math.max(0, (counts.DEF ?? 0) - 1);

  const raw = cover / DEPTH_CEILING - wasted * 0.1;
  return round1(Math.max(0, Math.min(1, raw)) * ROSTER_WEIGHTS.depth);
}

/**
 * Bye resilience, measured in the value actually sidelined in the worst week
 * rather than a headcount.
 *
 * Counting starters scored 3.8-5 out of 5 for every team, and treated losing a
 * top quarterback the same as losing a defence. Weighting each idle starter by
 * what he is worth separates a bad week from an inconvenient one.
 */
function scoreByes(
  starters: { slot: string; player: Player | null }[],
  vorp: VorpTable
): { score: number; worst: { week: number; count: number; lost: number } | null } {
  const byWeek = new Map<number, { count: number; lost: number }>();

  for (const s of starters) {
    const week = s.player?.bye_week;
    if (!week) continue;
    const entry = byWeek.get(week) ?? { count: 0, lost: 0 };
    entry.count += 1;
    entry.lost += vorpOf(s.player, vorp);
    byWeek.set(week, entry);
  }

  let worst: { week: number; count: number; lost: number } | null = null;
  for (const [week, e] of byWeek) {
    if (!worst || e.lost > worst.lost) worst = { week, ...e };
  }

  if (!worst) return { score: ROSTER_WEIGHTS.byes, worst: null };

  const raw =
    (BYE_WORST_LOST - worst.lost) / (BYE_WORST_LOST - BYE_BEST_LOST);
  return {
    score: round1(Math.max(0, Math.min(1, raw)) * ROSTER_WEIGHTS.byes),
    worst,
  };
}

// ----------------------------------------------------------------- draft side

/**
 * How close each live pick came to the best player actually available.
 * Scored on players passed over — see GradedPick.passedOver for why rank-minus-
 * pick is meaningless in a keeper format.
 */
function scoreValue(graded: GradedPick[]): number {
  const live = graded.filter((g) => g.shortfall !== null);
  // No ranks at all — award par rather than punishing a data outage.
  if (live.length === 0) return round1(DRAFT_WEIGHTS.value * 0.5);

  const mean =
    live.reduce((a, g) => a + (g.shortfall as number), 0) / live.length;
  return round1(
    Math.max(0, 1 - mean / VALUE_SHORTFALL_FLOOR) * DRAFT_WEIGHTS.value
  );
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
  const live = graded.filter((g) => g.shortfall !== null);
  if (live.length === 0) return round1(DRAFT_WEIGHTS.discipline * 0.5);

  const worst = Math.max(...live.map((g) => g.shortfall as number));
  return round1(
    Math.max(0, 1 - worst / WORST_SHORTFALL_FLOOR) * DRAFT_WEIGHTS.discipline
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

/**
 * Letters are anchored to the score an average roster in this format actually
 * earns, not to a notional 100.
 *
 * Twelve teams share one player pool, so no roster can hold the best player at
 * every slot and none ever will score near 100 — measured across a real
 * completed draft the field ran 44 to 73. Grading that against a 0-100 ladder
 * put every single team on a C or a D, which tells an owner nothing. The two
 * grades sit at different natural centres, so each gets its own ladder: an
 * exactly-average roster works out near 45 and an average draft near 70, and
 * both are pinned at B−, the middle of the scale. The roster anchor moved from
 * 55 to 45 when depth and bye weights were rebalanced onto the components that
 * actually separate teams; it tracks the measured centre and nothing else.
 *
 * These are fixed constants, not a curve. A genuinely great roster still earns
 * an A+ in a year when the rest of the league is weak, and a bad one still
 * earns a D in a strong year.
 */
const ROSTER_AVERAGE = 45;
const DRAFT_AVERAGE = 70;
const TIER = 4.5;

function letterAnchored(score: number, average: number): string {
  const tiers = (score - average) / TIER;
  if (tiers >= 4.5) return 'A+';
  if (tiers >= 3.5) return 'A';
  if (tiers >= 2.5) return 'A−';
  if (tiers >= 1.5) return 'B+';
  if (tiers >= 0.5) return 'B';
  if (tiers >= -0.5) return 'B−';
  if (tiers >= -1.5) return 'C+';
  if (tiers >= -2.5) return 'C';
  if (tiers >= -3.5) return 'C−';
  return 'D';
}

const letterForRoster = (score: number) => letterAnchored(score, ROSTER_AVERAGE);
const letterForDraft = (score: number) => letterAnchored(score, DRAFT_AVERAGE);

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
function computePickValue(
  picks: DraftPick[],
  playerMap: Map<number, Player>,
  ranks: Record<string, RankEntry>,
  vorp: VorpTable
): Map<number, { passedOver: number; shortfall: number }> {
  const result = new Map<number, { passedOver: number; shortfall: number }>();

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

    if (rank !== null && player) {
      let better = 0;
      let bestAtPosition = 0;
      for (const e of board) {
        if (gone.has(e.id)) continue;
        if (e.rank < rank) better++;
        if (playerMap.get(e.id)?.position !== player.position) continue;
        const v = vorp.get(e.id) ?? 0;
        if (v > bestAtPosition) bestAtPosition = v;
      }
      const taken = vorp.get(pick.player_id as number) ?? 0;
      result.set(pick.id, {
        passedOver: better,
        shortfall: Math.max(0, bestAtPosition - taken),
      });
    }

    gone.add(pick.player_id as number);
  }

  return result;
}

/**
 * Which letter to actually show, for one team and one of the two grades.
 *
 * There is exactly one rule and it lives here: while the draft is running the
 * curved letter is the honest one (an absolute score on a half-built roster
 * reads as "everyone is failing"), and once it finishes the absolute letter is.
 *
 * This exists because the board, the roster columns and the grades table each
 * used to decide for themselves, so the moment the draft completed the board
 * was still showing curved letters while the table had switched to absolute —
 * the same team reading A− in one place and C in another.
 */
export function displayGrade(
  grade: TeamGrade,
  which: 'draft' | 'roster',
  isDraftComplete: boolean
): { letter: string; rank: number; score: number; curved: boolean } {
  const block = grade[which];
  if (isDraftComplete) {
    return { letter: block.letter, rank: block.rank, score: block.score, curved: false };
  }
  const curved = grade.curve[which];
  return { letter: curved.letter, rank: curved.rank, score: block.score, curved: true };
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

  const vorp = buildVorpTable(playerMap, ranks);
  const ceilings = achievableCeilings(playerMap, vorp);
  const pickValue = computePickValue(picks, playerMap, ranks, vorp);

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
        gradedPicks.push({ player, pick, rank, passedOver: null, shortfall: null });
      } else {
        const pv = pickValue.get(pick.id);
        gradedPicks.push({
          player,
          pick,
          rank,
          passedOver: pv?.passedOver ?? null,
          shortfall: pv?.shortfall ?? null,
        });
      }
    }

    const starters = pickStarters(roster);
    const qbs = roster.filter((e) => e.player.position === 'QB');

    // Bye exposure among starters only — bench byes cost nothing.
    const byes = scoreByes(starters, vorp);
    const byeCollision = byes.worst
      ? { week: byes.worst.week, count: byes.worst.count }
      : null;

    const rosterComponents: Record<RosterComponent, number> = {
      lineup: scoreLineup(starters, vorp, ceilings.lineup),
      superflex: scoreSuperflex(qbs, vorp, ceilings.superflex),
      depth: scoreDepth(roster, starters, counts, vorp),
      byes: byes.score,
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
        letter: letterForDraft(draftScore),
        components: draftComponents,
      },
      roster: {
        score: rosterScore,
        letter: letterForRoster(rosterScore),
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
