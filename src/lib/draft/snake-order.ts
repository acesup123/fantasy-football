import { LEAGUE_CONFIG } from '@/types/database';

export interface DraftSlot {
  round: number;
  pickInRound: number;
  overallPick: number;
  ownerId: string;
}

/**
 * Generate a full snake draft order.
 *
 * Snake draft: odd rounds go 1→12, even rounds go 12→1.
 *
 * @param draftOrder - Array of 12 owner IDs in first-round order
 * @param numRounds - Number of rounds (default 15)
 * @returns Array of 180 draft slots
 */
export function generateSnakeOrder(
  draftOrder: string[],
  numRounds: number = LEAGUE_CONFIG.NUM_ROUNDS
): DraftSlot[] {
  const numTeams = draftOrder.length;
  const slots: DraftSlot[] = [];

  for (let round = 1; round <= numRounds; round++) {
    for (let pick = 1; pick <= numTeams; pick++) {
      const isEvenRound = round % 2 === 0;
      const pickInRound = isEvenRound ? numTeams - pick + 1 : pick;
      const ownerIndex = pickInRound - 1;

      slots.push({
        round,
        pickInRound,
        overallPick: (round - 1) * numTeams + pick,
        ownerId: draftOrder[ownerIndex],
      });
    }
  }

  return slots;
}

/**
 * Get the overall pick number for a specific round and pick position.
 */
export function getOverallPick(round: number, pickInRound: number): number {
  return (round - 1) * LEAGUE_CONFIG.NUM_TEAMS + pickInRound;
}

/**
 * Get the round and pick-in-round from an overall pick number.
 */
export function fromOverallPick(overallPick: number): {
  round: number;
  pickInRound: number;
} {
  const round = Math.ceil(overallPick / LEAGUE_CONFIG.NUM_TEAMS);
  const pickInRound =
    overallPick - (round - 1) * LEAGUE_CONFIG.NUM_TEAMS;
  return { round, pickInRound };
}

/**
 * Get all picks belonging to a specific owner in the draft.
 */
export function getOwnerPicks(
  slots: DraftSlot[],
  ownerId: string
): DraftSlot[] {
  return slots.filter((slot) => slot.ownerId === ownerId);
}

/**
 * Get the draft position label (e.g., "1.01", "2.12", "15.01").
 */
export function formatPickLabel(round: number, pickInRound: number): string {
  return `${round}.${String(pickInRound).padStart(2, '0')}`;
}
