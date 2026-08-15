import { describe, expect, it } from "vitest";
import {
  applySlotSwap,
  isValidLotteryOrder,
  lotteryStorageKey,
  validateFinalRankSlots,
  type LotterySlot,
} from "../lottery-order";

/** A clean 1-12 order: owner "o1" at slot 1 ... "o12" at slot 12. */
const order = (): LotterySlot[] =>
  Array.from({ length: 12 }, (_, i) => ({ ownerId: `o${i + 1}`, finish: i + 1 }));

const allOwners = new Set([
  ...Array.from({ length: 12 }, (_, i) => `o${i + 1}`),
  // departed owners are retained in the owners table
  "departed1",
  "departed2",
  "departed3",
]);

describe("validateFinalRankSlots", () => {
  it("accepts a gap-free 1-12 and returns it sorted", () => {
    const shuffled = [...order()].reverse();
    expect(validateFinalRankSlots(shuffled, allOwners)).toEqual(order());
  });

  it("rejects a short set (11 rows)", () => {
    expect(validateFinalRankSlots(order().slice(0, 11), allOwners)).toBeNull();
  });

  it("rejects an over-long set (13 rows)", () => {
    const rows = [...order(), { ownerId: "departed1", finish: 13 }];
    expect(validateFinalRankSlots(rows, allOwners)).toBeNull();
  });

  it("rejects a gap — 12 rows but ranks 1-11 and 13", () => {
    // This is the one that would otherwise produce silently wrong odds:
    // runLottery looks weights up by finish, so rank 13 gets weight 0 and can
    // never win a pick, renormalising the draw across the remaining teams.
    const rows = order();
    rows[11] = { ownerId: "o12", finish: 13 };
    expect(validateFinalRankSlots(rows, allOwners)).toBeNull();
  });

  it("rejects a duplicate final_rank", () => {
    const rows = order();
    rows[7] = { ownerId: "o8", finish: 7 };
    expect(validateFinalRankSlots(rows, allOwners)).toBeNull();
  });

  it("rejects a duplicate owner across two rows", () => {
    const rows = order();
    rows[5] = { ownerId: "o1", finish: 6 };
    expect(validateFinalRankSlots(rows, allOwners)).toBeNull();
  });

  it("drops rows for owners not in the owners table, which then fails the count", () => {
    const rows = order();
    rows[3] = { ownerId: "ghost", finish: 4 };
    expect(validateFinalRankSlots(rows, allOwners)).toBeNull();
  });

  it("accepts a departed owner who holds a placement for a season they played", () => {
    // Departed owners stay in the owners table, so a row belonging to one is a
    // known id and legitimately counts toward the 12 for that season.
    const rows = order();
    rows[0] = { ownerId: "departed1", finish: 1 };
    expect(validateFinalRankSlots(rows, allOwners)).not.toBeNull();
  });
});

describe("applySlotSwap", () => {
  it("swaps two lottery slots and preserves the permutation", () => {
    const next = applySlotSwap(order(), 5, "o9")!;

    expect(next).not.toBeNull();
    expect(next.find((s) => s.finish === 5)!.ownerId).toBe("o9");
    expect(next.find((s) => s.finish === 9)!.ownerId).toBe("o5");

    // still a valid 1-12 permutation with 12 distinct owners
    expect(next.map((s) => s.finish).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    );
    expect(new Set(next.map((s) => s.ownerId)).size).toBe(12);
  });

  it("leaves the locked top 4 byte-identical", () => {
    const next = applySlotSwap(order(), 7, "o11")!;
    expect(next.slice(0, 4)).toEqual(order().slice(0, 4));
  });

  it("refuses to write into a locked slot", () => {
    expect(applySlotSwap(order(), 4, "o9")).toBeNull();
    expect(applySlotSwap(order(), 1, "o12")).toBeNull();
  });

  it("refuses to pull an owner out of a locked slot", () => {
    expect(applySlotSwap(order(), 8, "o2")).toBeNull();
  });

  it("is a no-op when the owner already holds the slot", () => {
    expect(applySlotSwap(order(), 6, "o6")).toBeNull();
  });

  it("is a no-op for an unknown owner id", () => {
    expect(applySlotSwap(order(), 6, "nobody")).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = order();
    applySlotSwap(input, 5, "o9");
    expect(input).toEqual(order());
  });
});

describe("isValidLotteryOrder", () => {
  it("accepts the unmodified default order", () => {
    expect(isValidLotteryOrder(order(), order())).toBe(true);
  });

  it("accepts a reordering confined to slots 5-12", () => {
    const saved = applySlotSwap(order(), 5, "o9")!;
    expect(isValidLotteryOrder(saved, order())).toBe(true);
  });

  it("rejects an order whose locked top 4 disagrees with the server", () => {
    // The restore path is how a stale saved order could otherwise move a team
    // into or out of the locked slots — changing lottery participation, not
    // just odds.
    const saved = order();
    [saved[3], saved[4]] = [
      { ownerId: "o5", finish: 4 },
      { ownerId: "o4", finish: 5 },
    ];
    expect(isValidLotteryOrder(saved, order())).toBe(false);
  });

  it("rejects an order containing an owner from another season", () => {
    const saved = order();
    saved[6] = { ownerId: "departed1", finish: 7 };
    expect(isValidLotteryOrder(saved, order())).toBe(false);
  });

  it("rejects wrong length, duplicates and out-of-range slots", () => {
    expect(isValidLotteryOrder(order().slice(0, 11), order())).toBe(false);

    const dupSlot = order();
    dupSlot[7] = { ownerId: "o8", finish: 7 };
    expect(isValidLotteryOrder(dupSlot, order())).toBe(false);

    const outOfRange = order();
    outOfRange[11] = { ownerId: "o12", finish: 13 };
    expect(isValidLotteryOrder(outOfRange, order())).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidLotteryOrder(null, order())).toBe(false);
    expect(isValidLotteryOrder("nope", order())).toBe(false);
    expect(isValidLotteryOrder([{ ownerId: 1, finish: "x" }], order())).toBe(false);
  });
});

describe("lotteryStorageKey", () => {
  it("scopes the key by season so orders cannot leak across years", () => {
    expect(lotteryStorageKey(2025)).not.toBe(lotteryStorageKey(2026));
  });
});
