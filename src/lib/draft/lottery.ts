/**
 * Draft Order Lottery System
 *
 * Top 4 finishers get reverse draft order (locked):
 *   1st place → picks 12th
 *   2nd place → picks 11th
 *   3rd place → picks 10th
 *   4th place → picks 9th
 *
 * Bottom 8 (finishes 5-12) enter a weighted lottery for picks 1-8:
 *   5th place  → 25%
 *   6th place  →  3%
 *   7th place  →  2%
 *   8th place  →  1%
 *   9th place  → 40%
 *   10th place → 15%
 *   11th place → 10%
 *   12th place →  4%
 */

export const LOTTERY_WEIGHTS: Record<number, number> = {
  5: 25,
  6: 3,
  7: 2,
  8: 1,
  9: 40,
  10: 15,
  11: 10,
  12: 4,
};

interface StandingsEntry {
  ownerId: string;
  finish: number; // 1-12 regular season finish
}

interface LotteryResult {
  draftOrder: string[]; // 12 owner IDs, index 0 = pick 1
  lotteryResults: LotteryPick[]; // just the lottery portion (picks 1-8)
  lockedSlots: LockedSlot[]; // the top 4 (picks 9-12)
}

interface LotteryPick {
  draftPosition: number; // 1-8
  ownerId: string;
  finish: number;
  weight: number;
}

interface LockedSlot {
  draftPosition: number; // 9-12
  ownerId: string;
  finish: number;
}

/**
 * Run the full draft order lottery.
 *
 * Returns the complete 12-team draft order with lottery results for the bottom 8
 * and locked reverse-order slots for the top 4.
 */
export function runLottery(standings: StandingsEntry[]): LotteryResult {
  if (standings.length !== 12) {
    throw new Error(`Expected 12 teams, got ${standings.length}`);
  }

  // Separate top 4 and bottom 8
  const sorted = [...standings].sort((a, b) => a.finish - b.finish);
  const top4 = sorted.slice(0, 4); // finishes 1-4
  const bottom8 = sorted.slice(4);  // finishes 5-12

  // Top 4 get locked reverse draft positions (9-12)
  const lockedSlots: LockedSlot[] = top4.map((entry, i) => ({
    draftPosition: 12 - i, // 1st→12, 2nd→11, 3rd→10, 4th→9
    ownerId: entry.ownerId,
    finish: entry.finish,
  }));

  // Run weighted lottery for bottom 8 → draft positions 1-8
  const lotteryResults = runWeightedLottery(bottom8);

  // Assemble full draft order (index 0 = pick 1)
  const draftOrder: string[] = new Array(12);

  for (const pick of lotteryResults) {
    draftOrder[pick.draftPosition - 1] = pick.ownerId;
  }
  for (const slot of lockedSlots) {
    draftOrder[slot.draftPosition - 1] = slot.ownerId;
  }

  return { draftOrder, lotteryResults, lockedSlots };
}

/**
 * Run the weighted lottery for the bottom 8 teams.
 * Each team is drawn one at a time — once drawn, they're removed from the pool
 * and remaining weights are renormalized.
 */
function runWeightedLottery(entries: StandingsEntry[]): LotteryPick[] {
  const pool = entries.map((e) => ({
    ownerId: e.ownerId,
    finish: e.finish,
    weight: LOTTERY_WEIGHTS[e.finish] ?? 0,
  }));

  const results: LotteryPick[] = [];

  for (let draftPos = 1; draftPos <= 8; draftPos++) {
    const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);

    if (totalWeight === 0 || pool.length === 0) break;

    // Pick a random number in [0, totalWeight)
    let roll = Math.random() * totalWeight;
    let winner = pool[0];

    for (const entry of pool) {
      roll -= entry.weight;
      if (roll <= 0) {
        winner = entry;
        break;
      }
    }

    results.push({
      draftPosition: draftPos,
      ownerId: winner.ownerId,
      finish: winner.finish,
      weight: winner.weight,
    });

    // Remove winner from pool
    const idx = pool.findIndex((p) => p.ownerId === winner.ownerId);
    pool.splice(idx, 1);
  }

  return results;
}

/**
 * Simulate the lottery N times and return probability distribution.
 * Useful for showing owners their odds of each draft position.
 */
export function simulateLottery(
  standings: StandingsEntry[],
  simulations: number = 10000
): Map<string, Map<number, number>> {
  // Map<ownerId, Map<draftPosition, count>>
  const results = new Map<string, Map<number, number>>();

  for (const entry of standings) {
    results.set(entry.ownerId, new Map());
  }

  for (let i = 0; i < simulations; i++) {
    const { draftOrder } = runLottery(standings);
    draftOrder.forEach((ownerId, idx) => {
      const posMap = results.get(ownerId)!;
      posMap.set(idx + 1, (posMap.get(idx + 1) ?? 0) + 1);
    });
  }

  // Convert counts to percentages
  for (const [, posMap] of results) {
    for (const [pos, count] of posMap) {
      posMap.set(pos, (count / simulations) * 100);
    }
  }

  return results;
}

/**
 * Format lottery results for display.
 */
export function formatLotteryResults(result: LotteryResult): string {
  const lines: string[] = ["=== DRAFT ORDER LOTTERY ===", ""];

  lines.push("LOTTERY PICKS (1-8):");
  for (const pick of result.lotteryResults) {
    lines.push(
      `  Pick ${pick.draftPosition}: ${pick.ownerId} (finished ${pick.finish}th, ${pick.weight}% weight)`
    );
  }

  lines.push("");
  lines.push("LOCKED SLOTS (9-12):");
  for (const slot of result.lockedSlots) {
    lines.push(
      `  Pick ${slot.draftPosition}: ${slot.ownerId} (finished ${slot.finish}${ordinalSuffix(slot.finish)})`
    );
  }

  return lines.join("\n");
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
