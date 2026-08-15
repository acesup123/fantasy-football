import { describe, it, expect } from 'vitest';
import { assignRosterSlots, type FinalizeEntry } from '../finalize';

// A legal 15-round roster: 2 QB, 4 RB, 4 WR, 2 TE, 1 DEF, and picks in
// roughly realistic order.
function legalRoster(): FinalizeEntry[] {
  const spec: [number, string][] = [
    [1, 'RB'], [24, 'WR'], [25, 'QB'], [48, 'RB'], [49, 'WR'],
    [72, 'QB'], [73, 'TE'], [96, 'WR'], [97, 'RB'], [120, 'WR'],
    [121, 'TE'], [144, 'RB'], [145, 'DEF'], [168, 'WR'], [169, 'RB'],
  ];
  return spec.map(([overallPick, position], i) => ({
    playerId: i + 1,
    position,
    overallPick,
  }));
}

describe('assignRosterSlots', () => {
  it('fills every slot exactly once for a full 15-player roster', () => {
    const assigned = assignRosterSlots(legalRoster());
    expect(assigned).toHaveLength(15);
    const slots = assigned.map((a) => a.slot);
    expect(new Set(slots).size).toBe(15);
    // 9 starters + 6 bench, nobody on IR.
    expect(slots).not.toContain('IR1');
  });

  it('starts the earliest-drafted player at each position', () => {
    const assigned = assignRosterSlots(legalRoster());
    const bySlot = new Map(assigned.map((a) => [a.slot, a.playerId]));
    expect(bySlot.get('QB')).toBe(3);  // pick 25, first QB
    expect(bySlot.get('RB1')).toBe(1); // pick 1
    expect(bySlot.get('WR1')).toBe(2); // pick 24
    expect(bySlot.get('DEF')).toBe(13);
  });

  it('puts the second QB at superflex, not on the bench', () => {
    const assigned = assignRosterSlots(legalRoster());
    const sf = assigned.find((a) => a.slot === 'SF');
    expect(sf?.playerId).toBe(6); // pick 72, second QB
  });

  it('fills FLEX with the best remaining RB/WR/TE', () => {
    const assigned = assignRosterSlots(legalRoster());
    const flex = assigned.find((a) => a.slot === 'FLEX');
    // After RB1/RB2 (picks 1, 48) and WR1/WR2 (24, 49) and TE (73),
    // the best remaining RB/WR/TE is the WR at pick 96.
    expect(flex?.playerId).toBe(8);
  });

  it('benches leftovers in draft order', () => {
    const assigned = assignRosterSlots(legalRoster());
    const bench = assigned
      .filter((a) => a.slot.startsWith('BN'))
      .sort((a, b) => a.slot.localeCompare(b.slot))
      .map((a) => a.playerId);
    expect(bench).toHaveLength(6);
    // Bench order follows overall pick of whoever didn't crack the lineup.
    const picks = legalRoster();
    const byId = new Map(picks.map((p) => [p.playerId, p.overallPick]));
    const benchPicks = bench.map((id) => byId.get(id)!);
    expect(benchPicks).toEqual([...benchPicks].sort((a, b) => a - b));
  });

  it('handles a short roster without throwing', () => {
    // Defensive: a roster missing positions still assigns what it can.
    const assigned = assignRosterSlots([
      { playerId: 1, position: 'QB', overallPick: 10 },
      { playerId: 2, position: 'RB', overallPick: 20 },
    ]);
    expect(assigned).toEqual([
      { playerId: 1, slot: 'QB' },
      { playerId: 2, slot: 'RB1' },
    ]);
  });
});
