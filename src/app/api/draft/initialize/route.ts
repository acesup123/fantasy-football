import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateSnakeOrder } from "@/lib/draft/snake-order";

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

    // 6. Build draft_picks rows
    // For keeper slots: match keeper round_cost to the slot's round for that owner
    const pickRows = slots.map((slot) => {
      const ownerKeepers = keepersByOwner.get(slot.ownerId) ?? [];
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
        current_owner_id: slot.ownerId,
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

    return NextResponse.json({
      success: true,
      total_picks: pickRows.length,
      keeper_picks: pickRows.filter((p) => p.is_keeper).length,
      starting_pick: startingPick,
    });
  } catch (err) {
    console.error("Draft initialize error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
