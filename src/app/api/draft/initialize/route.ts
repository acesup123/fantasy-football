import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSnakeOrder } from "@/lib/draft/snake-order";
import { requireCommissioner } from "@/lib/api-auth";
import { fetchPickTrades } from "@/lib/draft/pick-ownership";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { season_id } = body;

    if (!season_id) {
      return NextResponse.json(
        { error: "Missing required field: season_id" },
        { status: 400 }
      );
    }

    // Initializing wipes and regenerates every draft pick for the season.
    const auth = await requireCommissioner();
    if (!auth.ok) return auth.response;

    // 1. Fetch the season
    const { data: season, error: seasonErr } = await supabase
      .from("seasons")
      .select("*")
      .eq("id", season_id)
      .single();

    if (seasonErr || !season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }

    // 2. Only allow initialization from pending or keepers_locked
    if (season.draft_status !== "pending" && season.draft_status !== "keepers_locked") {
      return NextResponse.json(
        { error: `Cannot initialize draft from status "${season.draft_status}". Must be "pending" or "keepers_locked".` },
        { status: 400 }
      );
    }

    // 3. Validate draft_order exists
    if (!season.draft_order || season.draft_order.length === 0) {
      return NextResponse.json(
        { error: "Season has no draft order set" },
        { status: 400 }
      );
    }

    // 4. Generate snake order slots
    const slots = generateSnakeOrder(season.draft_order);

    // 5. Fetch existing keepers for this season
    const { data: keepers } = await supabase
      .from("keepers")
      .select("owner_id, player_id, keeper_year, round_cost")
      .eq("season_id", season_id);

    // Build a map: owner_id -> keeper entries with their round costs
    const keepersByOwner = new Map<string, Array<{ player_id: number; keeper_year: number; round_cost: number }>>();
    if (keepers) {
      for (const k of keepers) {
        const list = keepersByOwner.get(k.owner_id) ?? [];
        list.push({ player_id: k.player_id, keeper_year: k.keeper_year, round_cost: k.round_cost });
        keepersByOwner.set(k.owner_id, list);
      }
    }

    // 5b. Traded picks. The snake order says who *originally* holds each slot;
    // accepted future_pick trades move current ownership. Without this an owner
    // drafts with a pick they traded away.
    const pickTrades = await fetchPickTrades(supabase, season.year);
    const tradedAway = new Map<string, number[]>();   // ownerId -> rounds given up
    const tradedFor = new Map<string, number[]>();    // ownerId -> rounds received
    for (const t of pickTrades) {
      if (!tradedAway.has(t.fromOwnerId)) tradedAway.set(t.fromOwnerId, []);
      tradedAway.get(t.fromOwnerId)!.push(t.round);
      if (!tradedFor.has(t.toOwnerId)) tradedFor.set(t.toOwnerId, []);
      tradedFor.get(t.toOwnerId)!.push(t.round);
    }

    /** Who actually owns this slot after trades. */
    const currentOwnerOf = (slot: { round: number; ownerId: string }): string => {
      const gaveUp = tradedAway.get(slot.ownerId);
      if (!gaveUp) return slot.ownerId;
      const idx = gaveUp.indexOf(slot.round);
      if (idx === -1) return slot.ownerId;

      // This owner traded a pick in this round — hand the slot to the receiver.
      gaveUp.splice(idx, 1);
      const receiver = pickTrades.find(
        t => t.fromOwnerId === slot.ownerId && t.round === slot.round
      );
      return receiver?.toOwnerId ?? slot.ownerId;
    };

    // 6. Build draft_picks rows
    // For keeper slots: match keeper round_cost to the slot's round for that owner
    const pickRows = slots.map((slot) => {
      const currentOwnerId = currentOwnerOf(slot);
      // Keepers occupy their owner's slot, so match against whoever holds it now.
      const ownerKeepers = keepersByOwner.get(currentOwnerId) ?? [];
      // Find a keeper assigned to this round
      const keeperMatch = ownerKeepers.find((k) => k.round_cost === slot.round);

      // If this slot is a keeper, remove it from the list so it's not double-matched
      if (keeperMatch) {
        const idx = ownerKeepers.indexOf(keeperMatch);
        ownerKeepers.splice(idx, 1);
      }

      return {
        season_id: season_id,
        round: slot.round,
        pick_in_round: slot.pickInRound,
        overall_pick: slot.overallPick,
        original_owner_id: slot.ownerId,
        current_owner_id: currentOwnerId,
        player_id: keeperMatch?.player_id ?? null,
        is_keeper: !!keeperMatch,
        keeper_year: keeperMatch?.keeper_year ?? null,
        picked_at: keeperMatch ? new Date().toISOString() : null,
        is_auto_pick: false,
      };
    });

    // 7. Delete any existing draft picks for this season (re-initialize)
    await supabase
      .from("draft_picks")
      .delete()
      .eq("season_id", season_id);

    // 8. Insert all 180 pick rows
    const { error: insertErr } = await supabase
      .from("draft_picks")
      .insert(pickRows);

    if (insertErr) {
      console.error("Failed to insert draft picks:", insertErr);
      return NextResponse.json(
        { error: "Failed to seed draft picks" },
        { status: 500 }
      );
    }

    // 9. Find the first non-keeper pick to set as current_pick_number
    const firstOpenPick = pickRows.find((p) => p.player_id === null);
    const startingPick = firstOpenPick?.overall_pick ?? 1;

    // 10. Update season status
    const { error: updateErr } = await supabase
      .from("seasons")
      .update({
        draft_status: "drafting",
        current_pick_number: startingPick,
        draft_started_at: new Date().toISOString(),
      })
      .eq("id", season_id);

    if (updateErr) {
      console.error("Failed to update season status:", updateErr);
      return NextResponse.json(
        { error: "Draft picks seeded but failed to update season status" },
        { status: 500 }
      );
    }

    // Every keeper must have landed in a slot — an unplaced one means the
    // owner has no pick in that round (traded away, or a cost collision that
    // wasn't resolved), and they'd silently lose the player.
    const unplaced = [...keepersByOwner.entries()].flatMap(([ownerId, ks]) =>
      ks.map((k) => ({ owner_id: ownerId, player_id: k.player_id, round_cost: k.round_cost }))
    );

    return NextResponse.json({
      success: true,
      total_picks: pickRows.length,
      keeper_picks: pickRows.filter((p) => p.is_keeper).length,
      starting_pick: startingPick,
      traded_picks_applied: pickTrades.length,
      unplaced_keepers: unplaced,
    });
  } catch (err) {
    console.error("Draft initialize error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
