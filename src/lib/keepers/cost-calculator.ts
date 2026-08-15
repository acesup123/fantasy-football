import { LEAGUE_CONFIG } from '@/types/database';

/**
 * Calculate the round cost for keeping a player.
 *
 * Rules:
 * - Each year kept, the round cost goes up by 1 (lower round number = higher cost)
 * - Round 1 keepers always cost round 1 (can't go higher)
 * - Free agent pickups start as round 10 keepers
 * - Max 5 years total (draft year + 4 keeper years)
 */
export function calculateKeeperCost(
  originalRound: number,
  yearsKept: number
): number {
  // Round 1 picks always cost round 1
  if (originalRound === 1) return 1;

  // Cost goes up (round number goes down) by 1 each year
  const cost = originalRound - yearsKept;

  // Floor at round 1
  return Math.max(1, cost);
}

/**
 * Determine if a player is eligible to be kept for another year.
 *
 * A player can be kept for up to 4 years after being drafted (K1-K4).
 * Draft year = year 1, K1 = year 2, K2 = year 3, K3 = year 4, K4 = year 5.
 */
export function isKeeperEligible(
  draftYear: number,
  currentYear: number
): boolean {
  const totalYears = currentYear - draftYear + 1;
  return totalYears <= LEAGUE_CONFIG.KEEPER_MAX_YEARS;
}

/**
 * Get the keeper year number (K1-K4) for a player.
 * Returns null if the player was just drafted (year 1) or is no longer eligible.
 */
export function getKeeperYear(
  draftYear: number,
  currentYear: number
): number | null {
  const yearsKept = currentYear - draftYear;
  if (yearsKept <= 0) return null; // Draft year, not a keeper yet
  if (yearsKept > 4) return null; // Past max keeper eligibility
  return yearsKept; // 1 = K1, 2 = K2, 3 = K3, 4 = K4
}

/** One season of a player's draft record, oldest-to-newest when in a list. */
export interface DraftHistoryEntry {
  year: number;
  round: number;
  isKeeper: boolean;
  keeperYear: number | null;
}

export interface KeeperCost {
  keeperYear: number;      // K1-K4
  roundCost: number;       // round this keeper occupies next season
  sourceType: 'draft' | 'free_agent';
  eligible: boolean;
  basis: string;           // human-readable explanation, for the sync log
  reason?: string;         // why not eligible
}

/**
 * Cost for keeping a player into `targetYear`, derived from draft history.
 *
 * Basis: the first year you keep a player (K1) costs his previous draft spot —
 * no escalation. Escalation starts at K2, moving up one round per additional
 * year kept. So a player drafted in round 6 costs round 6 as a K1, round 5 as
 * a K2, round 4 as a K3, round 3 as a K4.
 *
 * Round 1 keepers always cost round 1.
 *
 * A player with no record in `targetYear - 1` was picked up as a free agent
 * and starts at the free-agent keeper round.
 */
export function computeKeeperCost(
  history: DraftHistoryEntry[],
  targetYear: number,
  options: {
    /**
     * How the owner held the player at the end of last season. Drafted or
     * traded-for keeps his draft status; dropped and re-added off the wire
     * resets him to a free agent even if he was drafted earlier that year.
     */
    keepsDraftStatus?: boolean;
  } = {}
): KeeperCost {
  const prior = history
    .filter(h => h.year < targetYear)
    .sort((a, b) => a.year - b.year);
  const last = prior[prior.length - 1];

  // Dropped and re-added — draft status is gone.
  if (options.keepsDraftStatus === false) {
    return {
      keeperYear: 1,
      roundCost: LEAGUE_CONFIG.FREE_AGENT_KEEPER_ROUND,
      sourceType: 'free_agent',
      eligible: true,
      basis: last && last.year === targetYear - 1
        ? `picked up off waivers after being drafted in round ${last.round} — draft status resets`
        : 'free agent pickup',
    };
  }

  // Not drafted last season → free agent pickup.
  if (!last || last.year !== targetYear - 1) {
    return {
      keeperYear: 1,
      roundCost: LEAGUE_CONFIG.FREE_AGENT_KEEPER_ROUND,
      sourceType: 'free_agent',
      eligible: true,
      basis: last
        ? `no ${targetYear - 1} draft record (last seen ${last.year}) — free agent pickup`
        : 'no draft history — free agent pickup',
    };
  }

  // K1 if last season was his draft year, otherwise one past last season's K.
  const keeperYear = (last.isKeeper ? (last.keeperYear ?? 0) : 0) + 1;

  if (keeperYear > 4) {
    return {
      keeperYear,
      roundCost: 0,
      sourceType: 'draft',
      eligible: false,
      basis: `kept through K${last.keeperYear} in ${last.year}`,
      reason: 'Max keeper years reached (K4 is the final eligible year)',
    };
  }

  // K1 sits at last season's draft spot; escalation starts at K2.
  const escalates = last.isKeeper;
  const roundCost = last.round === 1 ? 1 : Math.max(1, last.round - (escalates ? 1 : 0));

  let basis: string;
  if (last.round === 1) {
    basis = `${last.year} round 1 — round 1 keepers always cost round 1`;
  } else if (escalates) {
    basis = `${last.year} round ${last.round} (K${last.keeperYear}) → round ${roundCost} (K${keeperYear} escalates)`;
  } else {
    basis = `drafted ${last.year} round ${last.round} → round ${roundCost} (K1 holds the draft spot)`;
  }

  return {
    keeperYear,
    roundCost,
    sourceType: 'draft',
    eligible: true,
    basis,
  };
}

export interface RoundConflictInput {
  playerName: string;
  baseRound: number;
  /** Lower is better. */
  rank: number;
}

export interface RoundConflictResult extends RoundConflictInput {
  finalRound: number;
  /** Set when the keeper had to move off its base round. */
  bumpedFrom?: number;
  /** Set when there's no legal round left for this keeper. */
  unresolved?: string;
}

/**
 * Assign each of one owner's keepers to a draft round they can actually use.
 *
 * Two rules drive a keeper off its base round:
 *
 *   1. Collision — when two keepers cost the same round, the higher-ranked
 *      player moves up a round. Two round-10 keepers become rounds 10 and 9.
 *   2. Ownership — a keeper occupies one of the owner's picks, so a keeper
 *      whose round was traded away moves up to the next round the owner holds.
 *
 * Round 1 is the ceiling. Keeping two round-1 keepers means owning two firsts;
 * when there's nowhere left to move, that's reported rather than resolved.
 *
 * Keepers are placed cheapest-round-first, and within a tied round the
 * lower-ranked player keeps the original round while better players move up.
 *
 * @param picksByRound round → how many picks the owner holds. Omit to assume
 *                     one pick in every round.
 */
export function resolveRoundConflicts(
  keepers: RoundConflictInput[],
  picksByRound?: Map<number, number>
): RoundConflictResult[] {
  const ordered = [...keepers].sort((a, b) => {
    if (a.baseRound !== b.baseRound) return a.baseRound - b.baseRound;
    return b.rank - a.rank; // worst-ranked first — better players get bumped up
  });

  const capacity = (round: number) => picksByRound?.get(round) ?? 1;
  const used = new Map<number, string[]>();
  const hasRoom = (round: number) => (used.get(round)?.length ?? 0) < capacity(round);

  const results: RoundConflictResult[] = [];

  for (const k of ordered) {
    let round = k.baseRound;
    while (round >= 1 && !hasRoom(round)) round--;

    if (round < 1) {
      results.push({
        ...k,
        finalRound: k.baseRound,
        unresolved:
          `no available pick at or above round ${k.baseRound} — ` +
          `requires owning an extra early pick`,
      });
      continue;
    }

    if (!used.has(round)) used.set(round, []);
    used.get(round)!.push(k.playerName);

    results.push({
      ...k,
      finalRound: round,
      ...(round !== k.baseRound ? { bumpedFrom: k.baseRound } : {}),
    });
  }

  return results;
}

/**
 * Full keeper eligibility check with cost calculation.
 */
export function getKeeperInfo(params: {
  originalRound: number;
  draftYear: number;
  currentYear: number;
  sourceType: 'draft' | 'free_agent' | 'trade';
}): {
  eligible: boolean;
  keeperYear: number | null;
  roundCost: number;
  yearsRemaining: number;
  label: string; // e.g., "K2 — Round 7"
} {
  const { draftYear, currentYear, sourceType } = params;
  let { originalRound } = params;

  // Free agents start as round 10
  if (sourceType === 'free_agent') {
    originalRound = LEAGUE_CONFIG.FREE_AGENT_KEEPER_ROUND;
  }

  const eligible = isKeeperEligible(draftYear, currentYear);
  const keeperYear = getKeeperYear(draftYear, currentYear);
  const yearsKept = currentYear - draftYear;
  const roundCost = calculateKeeperCost(originalRound, yearsKept);
  const yearsRemaining = eligible
    ? LEAGUE_CONFIG.KEEPER_MAX_YEARS - (currentYear - draftYear + 1)
    : 0;

  let label = '';
  if (!eligible) {
    label = 'Not eligible';
  } else if (keeperYear === null) {
    label = `Draft year — Round ${originalRound}`;
  } else {
    label = `K${keeperYear} — Round ${roundCost}`;
  }

  return {
    eligible: eligible && keeperYear !== null, // Must be past draft year to keep
    keeperYear,
    roundCost,
    yearsRemaining,
    label,
  };
}
