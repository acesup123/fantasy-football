import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { season_id, overall_pick, player_id, owner_id } = body;

    if (!season_id || !overall_pick || !player_id || !owner_id) {
      return NextResponse.json(
        { error: "Missing required fields: season_id, overall_pick, player_id, owner_id" },
        { status: 400 }
      );
    }

    // 1. Verify the season is in "drafting" status and the current pick matches
    const { data: season, error: seasonErr } = await supabase
      .from("seasons")
      .select("id, draft_status, current_pick_number")
      .eq("id", season_id)
      .single();

    if (seasonErr || !season) {
      return NextResponse.json({ error: "Season not found" }, { status: 404 });
    }

    if (season.draft_status !== "drafting") {
      return NextResponse.json(
        { error: "Draft is not in progress" },
        { status: 400 }
      );
    }

    if (season.current_pick_number !== overall_pick) {
      return NextResponse.json(
        { error: `Not the current pick. Expected pick ${season.current_pick_number}, got ${overall_pick}` },
        { status: 400 }
      );
    }

    // 2. Verify it's this owner's turn
    const { data: pickRow, error: pickErr } = await supabase
      .from("draft_picks")
      .select("id, current_owner_id, player_id")
      .eq("season_id", season_id)
      .eq("overall_pick", overall_pick)
      .single();

    if (pickErr || !pickRow) {
      return NextResponse.json(
        { error: "Draft pick slot not found" },
        { status: 404 }
      );
    }

    if (pickRow.current_owner_id !== owner_id) {
      return NextResponse.json(
        { error: "Not your turn" },
        { status: 403 }
      );
    }

    if (pickRow.player_id !== null) {
      return NextResponse.json(
        { error: "This pick has already been made" },
        { status: 400 }
      );
    }

    // 3. Verify the player hasn't already been drafted this season
    const { data: existing } = await supabase
      .from("draft_picks")
      .select("id")
      .eq("season_id", season_id)
      .eq("player_id", player_id)
      .not("player_id", "is", null)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Player has already been drafted" },
        { status: 400 }
      );
    }

    // 4. Update the draft pick
    const { error: updatePickErr } = await supabase
      .from("draft_picks")
      .update({
        player_id: player_id,
        picked_at: new Date().toISOString(),
      })
      .eq("id", pickRow.id);

    if (updatePickErr) {
      console.error("Failed to update draft pick:", updatePickErr);
      return NextResponse.json(
        { error: "Failed to record pick" },
        { status: 500 }
      );
    }

    // 5. Increment current_pick_number on the season
    const { error: updateSeasonErr } = await supabase
      .from("seasons")
      .update({
        current_pick_number: overall_pick + 1,
      })
      .eq("id", season_id);

    if (updateSeasonErr) {
      console.error("Failed to update season pick number:", updateSeasonErr);
      // Pick was recorded, but season counter failed — log but don't fail the request
    }

    return NextResponse.json({ success: true, pick_number: overall_pick });
  } catch (err) {
    console.error("Draft pick error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
