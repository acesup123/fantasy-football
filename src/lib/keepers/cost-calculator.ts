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
