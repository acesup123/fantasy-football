import { ROSTER_SLOTS } from '@/types/database';
import type { RosterSlot } from '@/types/database';

/**
 * Turn an owner's 15 drafted players into a starting lineup + bench for the
 * end-of-draft roster snapshot.
 *
 * The draft validates minimums (1 QB, 2 RB, 2 WR, 1 TE, 1 DEF), so a legal
 * roster always fills every starting slot. Slots are filled greedily with the
 * earliest-drafted eligible player — draft position is the only signal of
 * intent we have, and owners take their starters first.
 */

export interface FinalizeEntry {
  playerId: number;
  position: string;
  /** Lower = drafted earlier = presumed better. Keepers use their slot. */
  overallPick: number;
}

/** Starting slots in fill order. FLEX before SF so RB/WR/TE fill the tighter
 *  slot first and a second QB naturally lands at superflex. */
const STARTING_SLOTS: RosterSlot[] = [
  'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SF', 'DEF',
];

const BENCH_SLOTS: RosterSlot[] = ['BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6'];

/** Overflow only — a legal 15-round roster fits in starters + bench. */
const IR_SLOTS: RosterSlot[] = ['IR1', 'IR2'];

export interface SlotAssignment {
  playerId: number;
  slot: RosterSlot;
}

export function assignRosterSlots(entries: FinalizeEntry[]): SlotAssignment[] {
  const pool = [...entries].sort((a, b) => a.overallPick - b.overallPick);
  const assigned: SlotAssignment[] = [];

  for (const slot of STARTING_SLOTS) {
    const eligible = ROSTER_SLOTS[slot].eligible as readonly string[];
    const idx = pool.findIndex((p) => eligible.includes(p.position));
    if (idx === -1) continue; // shouldn't happen on a legal roster
    assigned.push({ playerId: pool[idx].playerId, slot });
    pool.splice(idx, 1);
  }

  for (const [i, p] of pool.entries()) {
    const slot = [...BENCH_SLOTS, ...IR_SLOTS][i];
    if (!slot) break; // more than 17 players can't be represented
    assigned.push({ playerId: p.playerId, slot });
  }

  return assigned;
}
