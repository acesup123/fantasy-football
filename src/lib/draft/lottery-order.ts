/**
 * Draft-order seeding invariants.
 *
 * Slot number IS the odds — LOTTERY_WEIGHTS is keyed by it, and slots 1-4 are
 * locked out of the draw entirely. So any bug that moves a team between slots
 * changes either their odds or whether they are in the lottery at all, and it
 * looks completely plausible on screen. That is why this logic lives here,
 * separate from the components, with tests.
 */

export type LotterySlot = { ownerId: string; finish: number };

/** Slots 1-4 are locked in reverse order and are not the admin's to move. */
export const LOCKED_SLOT_COUNT = 4;

/**
 * Turn raw (owner_id, final_rank) rows into a verified 1-12 order.
 *
 * Returns null unless the result is a gap-free 1-12 held by 12 distinct known
 * owners. A partial or duplicated set means a bad sync, and seeding the lottery
 * off it would silently produce wrong odds — runLottery does not validate
 * finish values, it just looks weights up by them.
 */
export function validateFinalRankSlots(
  rows: { ownerId: string; finish: number }[],
  knownOwnerIds: Set<string>
): LotterySlot[] | null {
  const slots = rows
    .filter((r) => knownOwnerIds.has(r.ownerId))
    .map((r) => ({ ownerId: r.ownerId, finish: r.finish }))
    .sort((a, b) => a.finish - b.finish);

  if (slots.length !== 12) return null;
  if (!slots.every((s, i) => s.finish === i + 1)) return null;
  if (new Set(slots.map((s) => s.ownerId)).size !== 12) return null;

  return slots;
}

/**
 * Move an owner into a lottery slot by SWAPPING with whoever holds it.
 *
 * Swapping rather than overwriting is what preserves the 1-12 permutation —
 * an overwrite would duplicate one owner and drop another, leaving 11 teams in
 * the draw. Returns null (no change) for any move that isn't allowed.
 */
export function applySlotSwap(
  standings: LotterySlot[],
  finish: number,
  ownerId: string
): LotterySlot[] | null {
  const current = standings.find((s) => s.finish === finish);
  if (!current || current.ownerId === ownerId) return null;

  const displacedFrom = standings.find((s) => s.ownerId === ownerId)?.finish;
  if (displacedFrom === undefined) return null;

  // Never let a swap touch the locked top 4
  if (finish <= LOCKED_SLOT_COUNT || displacedFrom <= LOCKED_SLOT_COUNT) return null;

  return standings.map((s) => {
    if (s.finish === finish) return { ...s, ownerId };
    if (s.finish === displacedFrom) return { ...s, ownerId: current.ownerId };
    return s;
  });
}

/**
 * Validate an order restored from localStorage against the season it belongs to.
 *
 * Checks membership against `defaultOrder`'s exact 12 teams (not the owners
 * table, which retains departed owners), and pins slots 1-4 to the server's
 * values — a saved order that disagrees there would change who is in the draw.
 */
export function isValidLotteryOrder(
  value: unknown,
  defaultOrder: LotterySlot[]
): value is LotterySlot[] {
  if (!Array.isArray(value) || value.length !== 12) return false;

  const seasonOwnerIds = new Set(defaultOrder.map((s) => s.ownerId));
  const lockedBySlot = new Map(
    defaultOrder
      .filter((s) => s.finish <= LOCKED_SLOT_COUNT)
      .map((s) => [s.finish, s.ownerId])
  );

  const slots = new Set<number>();
  const owners = new Set<string>();

  for (const entry of value) {
    if (typeof entry?.ownerId !== "string" || typeof entry?.finish !== "number") {
      return false;
    }
    if (!seasonOwnerIds.has(entry.ownerId)) return false;
    if (entry.finish < 1 || entry.finish > 12) return false;
    if (
      entry.finish <= LOCKED_SLOT_COUNT &&
      lockedBySlot.get(entry.finish) !== entry.ownerId
    ) {
      return false;
    }
    slots.add(entry.finish);
    owners.add(entry.ownerId);
  }

  return slots.size === 12 && owners.size === 12;
}

/** localStorage key, scoped so an order can't leak across seasons. */
export function lotteryStorageKey(seasonYear: number): string {
  return `banl:lottery-order:${seasonYear}`;
}
