import { REQUIRED_POSITIONS, ROSTER_MINIMUMS } from '@/types/database';
import type { DraftPick, Player } from '@/types/database';

export type RequiredPosition = (typeof REQUIRED_POSITIONS)[number];

/** Positions in the order rosters are read: QB, RB, WR, TE, DEF. */
export const POSITION_ORDER: RequiredPosition[] = [...REQUIRED_POSITIONS];

export interface RosterCounts {
  [position: string]: number;
}

export interface RequirementState {
  /** How many of each required position the roster is still short. */
  deficits: Partial<Record<RequiredPosition, number>>;
  /** Total picks that must go to required positions to finish legal. */
  totalDeficit: number;
  /** Picks the owner still has, including the one on the clock. */
  slotsRemaining: number;
  /**
   * Positions the owner is forced to take right now. Empty when there is
   * slack; every deficit position once the slack runs out.
   */
  requiredNow: RequiredPosition[];
  /**
   * True when the owner cannot fill the minimums even by spending every
   * remaining pick on them — only reachable by trading picks away.
   */
  impossible: boolean;
}

/** Tally a list of drafted players by position. */
export function countRoster(roster: { position: string }[]): RosterCounts {
  const counts: RosterCounts = {};
  for (const p of roster) {
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  return counts;
}

/**
 * Work out what an owner still owes their roster.
 *
 * `slotsRemaining` counts every unfilled pick the owner holds, the current
 * one included. The rule: the number of positions still missing can never
 * exceed the number of picks left to fill them.
 */
export function getRequirementState(
  counts: RosterCounts,
  slotsRemaining: number
): RequirementState {
  const deficits: Partial<Record<RequiredPosition, number>> = {};
  let totalDeficit = 0;

  for (const pos of POSITION_ORDER) {
    const short = ROSTER_MINIMUMS[pos] - (counts[pos] ?? 0);
    if (short > 0) {
      deficits[pos] = short;
      totalDeficit += short;
    }
  }

  const deficitPositions = POSITION_ORDER.filter((p) => deficits[p]);

  return {
    deficits,
    totalDeficit,
    slotsRemaining,
    // With slack left, anything goes. Once deficits equal the picks left,
    // every remaining pick is spoken for.
    requiredNow: totalDeficit >= slotsRemaining ? deficitPositions : [],
    impossible: totalDeficit > slotsRemaining,
  };
}

/**
 * Check whether drafting `position` leaves the roster still fillable.
 *
 * Returns an error message when the pick would strand a requirement — e.g.
 * taking a 4th WR with 3 picks left and no QB, TE, or DEF on the roster.
 */
export function validatePick(
  counts: RosterCounts,
  slotsRemaining: number,
  position: string
): { ok: true } | { ok: false; error: string } {
  const state = getRequirementState(counts, slotsRemaining);

  if (state.requiredNow.length === 0) return { ok: true };
  if (state.requiredNow.includes(position as RequiredPosition)) return { ok: true };

  const needed = state.requiredNow
    .map((p) => `${state.deficits[p]} ${p}`)
    .join(', ');
  const picks = slotsRemaining === 1 ? 'pick' : 'picks';

  return {
    ok: false,
    error: `Roster requirement: you have ${slotsRemaining} ${picks} left and still need ${needed}. Draft one of ${state.requiredNow.join('/')}.`,
  };
}

/** Positions missing from a finished roster. Empty means the roster is legal. */
export function missingPositions(counts: RosterCounts): RequiredPosition[] {
  return POSITION_ORDER.filter(
    (pos) => (counts[pos] ?? 0) < ROSTER_MINIMUMS[pos]
  );
}

export interface OwnerRoster {
  ownerId: string;
  /** Drafted players grouped by POSITION_ORDER, then by pick order. */
  byPosition: { position: RequiredPosition; players: RosterEntry[] }[];
  counts: RosterCounts;
  filled: number;
  slotsRemaining: number;
  requirements: RequirementState;
}

export interface RosterEntry {
  player: Player;
  pick: DraftPick;
}

/**
 * Turn the flat pick list into per-owner rosters, one entry per owner who
 * holds any pick. Picks follow their current owner, so a traded pick lands on
 * the roster of whoever holds it now.
 */
export function buildOwnerRosters(
  picks: DraftPick[],
  playerMap: Map<number, Player>
): Map<string, OwnerRoster> {
  const entries = new Map<string, RosterEntry[]>();
  const openSlots = new Map<string, number>();

  for (const pick of picks) {
    const id = pick.current_owner_id;
    if (pick.player_id === null) {
      openSlots.set(id, (openSlots.get(id) ?? 0) + 1);
      continue;
    }
    const player = playerMap.get(pick.player_id);
    if (!player) continue;
    const list = entries.get(id) ?? [];
    list.push({ player, pick });
    entries.set(id, list);
  }

  const rosters = new Map<string, OwnerRoster>();
  const ownerIds = new Set([...entries.keys(), ...openSlots.keys()]);

  for (const ownerId of ownerIds) {
    const list = (entries.get(ownerId) ?? []).sort(
      (a, b) => a.pick.overall_pick - b.pick.overall_pick
    );
    const counts = countRoster(list.map((e) => e.player));
    const slotsRemaining = openSlots.get(ownerId) ?? 0;

    rosters.set(ownerId, {
      ownerId,
      byPosition: POSITION_ORDER.map((position) => ({
        position,
        players: list.filter((e) => e.player.position === position),
      })),
      counts,
      filled: list.length,
      slotsRemaining,
      requirements: getRequirementState(counts, slotsRemaining),
    });
  }

  return rosters;
}

/** "Patrick Mahomes" → "P. Mahomes", so names survive a narrow column. */
export function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  // Team defenses ("49ers D/ST") read worse abbreviated.
  if (name.includes('D/ST')) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}
