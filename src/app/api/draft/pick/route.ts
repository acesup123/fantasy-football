import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireActingOwner } from "@/lib/api-auth";
import { countRoster, validatePick } from "@/lib/draft/roster-requirements";

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

    // owner_id arrives in the request body, so it is a claim, not an identity.
    // Verify the caller actually is that owner (or the commissioner).
    const auth = await requireActingOwner(owner_id);
    if (!auth.ok) return auth.response;

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

    // 4. Every roster must end the draft with 1 QB, 2 RB, 2 WR, 1 TE, 1 DEF.
    // Reject a pick that would leave more requirements outstanding than the
    // owner has picks left to fill them — otherwise the shortfall only shows
    // up at the end of the draft, when it can no longer be fixed.
    const [{ data: pickedPlayer }, { data: ownerSlots }] = await Promise.all([
      supabase.from("players").select("position").eq("id", player_id).single(),
      supabase
        .from("draft_picks")
        .select("player_id, players(position)")
        .eq("season_id", season_id)
        .eq("current_owner_id", owner_id),
    ]);

    if (!pickedPlayer) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    if (ownerSlots) {
      // The embedded relation comes back as an object for a to-one FK, but
      // normalize both shapes — a silently-empty roster would read as "needs
      // everything" and lock the owner out of their own board.
      const filled = ownerSlots
        .filter((s) => s.player_id !== null)
        .flatMap((s) => {
          const rel = s.players as unknown;
          const row = Array.isArray(rel) ? rel[0] : rel;
          const position = (row as { position?: string } | null)?.position;
          return position ? [{ position }] : [];
        });
      const slotsRemaining = ownerSlots.filter((s) => s.player_id === null).length;

      const check = validatePick(
        countRoster(filled),
        slotsRemaining,
        pickedPlayer.position
      );
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    // 5. Update the draft pick
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

    // 6. Advance to the next slot that still needs a pick.
    //
    // A blind +1 deadlocks the draft: 60 of the 180 slots are pre-filled
    // keepers, so the counter lands on one, every pick attempt there fails
    // with "already been made", and nothing ever advances it again.
    const { data: nextOpen } = await supabase
      .from("draft_picks")
      .select("overall_pick")
      .eq("season_id", season_id)
      .is("player_id", null)
      .gt("overall_pick", overall_pick)
      .order("overall_pick", { ascending: true })
      .limit(1)
      .maybeSingle();

    const draftComplete = !nextOpen;

    const { error: updateSeasonErr } = await supabase
      .from("seasons")
      .update(
        draftComplete
          ? { current_pick_number: null, draft_status: "complete" }
          : { current_pick_number: nextOpen.overall_pick }
      )
      .eq("id", season_id);

    if (updateSeasonErr) {
      console.error("Failed to update season pick number:", updateSeasonErr);
      // Pick was recorded, but season counter failed — log but don't fail the request
    }

    return NextResponse.json({
      success: true,
      pick_number: overall_pick,
      // The client must use this rather than assuming +1 — the next slot is
      // often a keeper further down the board.
      next_pick: nextOpen?.overall_pick ?? null,
      draft_complete: draftComplete,
    });
  } catch (err) {
    console.error("Draft pick error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
