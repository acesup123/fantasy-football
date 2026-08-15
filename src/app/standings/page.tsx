import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { compareStandings, getCurrentNFLSeason } from "@/lib/espn/client";
import { StandingsTable, type StandingsRow } from "./standings-table";

interface ResultRow {
  owner_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  playoff_seed: number | null;
  final_rank: number | null;
  streak_length: number | null;
  streak_type: string | null;
  games_back: number | null;
  owners: { name: string; team_name: string } | null;
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const year = parseInt(params.year ?? "") || getCurrentNFLSeason();

  const supabase = await createClient();

  const { data: season } = await supabase
    .from("seasons")
    .select("id, year")
    .eq("year", year)
    .single();

  const { data: rows } = season
    ? await supabase
        .from("season_results")
        .select(
          "owner_id, wins, losses, ties, points_for, points_against, playoff_seed, final_rank, streak_length, streak_type, games_back, owners(name, team_name)"
        )
        .eq("season_id", season.id)
    : { data: null };

  const results = ((rows ?? []) as unknown as ResultRow[]).map(
    (r): StandingsRow => ({
      ownerId: r.owner_id,
      ownerName: r.owners?.name ?? "Unknown",
      teamName: r.owners?.team_name ?? null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: Number(r.points_for),
      pointsAgainst: Number(r.points_against),
      playoffSeed: r.playoff_seed,
      finalRank: r.final_rank,
      streakLength: r.streak_length,
      streakType:
        r.streak_type === "WIN" || r.streak_type === "LOSS" || r.streak_type === "TIE"
          ? r.streak_type
          : null,
      gamesBack: r.games_back === null ? null : Number(r.games_back),
    })
  );

  // Shared comparator — ESPN's own seed when we have it (it accounts for
  // divisions and H2H tiebreaks), win pct otherwise.
  results.sort(compareStandings);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link href="/" className="text-xs text-muted hover:text-accent">
          ← Home
        </Link>
        <h1 className="text-3xl font-black mt-2">{year} Standings</h1>
        <p className="text-muted text-sm mt-1">
          Synced nightly from ESPN. Hit refresh for live in-week records.
        </p>
      </div>

      {results.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted">
            No standings stored for {year} yet.
          </p>
          <p className="text-xs text-muted/60 mt-2">
            The nightly sync populates this. ESPN data is only available from 2018
            onward.
          </p>
        </div>
      ) : (
        <StandingsTable initial={results} year={year} />
      )}
    </div>
  );
}
