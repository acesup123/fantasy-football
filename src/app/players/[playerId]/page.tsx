import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getKeeperInfo } from "@/lib/keepers/cost-calculator";

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  DEF: "pos-def",
  K: "pos-def",
};

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const id = parseInt(playerId, 10);
  if (isNaN(id)) return notFound();

  const supabase = await createClient();

  // Fetch player
  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", id)
    .single();

  if (!player) return notFound();

  // Fetch draft history
  const { data: draftPicks } = await supabase
    .from("draft_picks")
    .select(
      "id, round, pick_in_round, overall_pick, is_keeper, keeper_year, seasons(year), owners!draft_picks_current_owner_id_fkey(id, name)"
    )
    .eq("player_id", id)
    .order("season_id", { ascending: false });

  // Fetch matchup lineups for fantasy performance
  const { data: lineups } = await supabase
    .from("matchup_lineups")
    .select(
      "id, lineup_slot, points, is_starter, owner_id, matchups(season_id, week, seasons(year))"
    )
    .eq("player_id", id);

  // Get unique owner IDs from draft picks and lineups
  const ownerIds = new Set<string>();
  for (const dp of draftPicks ?? []) {
    const owner = (dp as any).owners;
    if (owner?.id) ownerIds.add(owner.id);
  }
  for (const l of lineups ?? []) {
    if (l.owner_id) ownerIds.add(l.owner_id);
  }

  // Fetch owner names for lineups
  const { data: allOwners } = await supabase
    .from("owners")
    .select("id, name, team_name")
    .in("id", Array.from(ownerIds));

  const ownerMap = new Map(
    (allOwners ?? []).map((o) => [o.id, o])
  );

  // Fantasy performance calculations
  const starterGames = (lineups ?? []).filter((l) => l.is_starter);
  const allGames = lineups ?? [];
  const totalPoints = allGames.reduce((sum, l) => sum + (l.points ?? 0), 0);
  const starterPoints = starterGames.reduce(
    (sum, l) => sum + (l.points ?? 0),
    0
  );
  const avgPpg =
    starterGames.length > 0 ? starterPoints / starterGames.length : 0;

  // Best single game
  let bestGame: {
    points: number;
    year: number;
    week: number;
    ownerName: string;
  } | null = null;
  for (const l of allGames) {
    const matchup = l.matchups as any;
    const pts = l.points ?? 0;
    if (!bestGame || pts > bestGame.points) {
      bestGame = {
        points: pts,
        year: matchup?.seasons?.year ?? 0,
        week: matchup?.week ?? 0,
        ownerName: ownerMap.get(l.owner_id)?.name ?? "Unknown",
      };
    }
  }

  // Season-by-season breakdown
  const seasonStats = new Map<
    number,
    { year: number; games: number; starterGames: number; points: number; starterPoints: number }
  >();
  for (const l of allGames) {
    const matchup = l.matchups as any;
    const year = matchup?.seasons?.year ?? 0;
    if (!seasonStats.has(year)) {
      seasonStats.set(year, { year, games: 0, starterGames: 0, points: 0, starterPoints: 0 });
    }
    const s = seasonStats.get(year)!;
    s.games++;
    s.points += l.points ?? 0;
    if (l.is_starter) {
      s.starterGames++;
      s.starterPoints += l.points ?? 0;
    }
  }
  const seasonBreakdown = Array.from(seasonStats.values()).sort(
    (a, b) => b.year - a.year
  );

  // Ownership timeline — combine draft picks and lineups
  const ownershipEvents: {
    year: number;
    ownerId: string;
    ownerName: string;
    type: "drafted" | "rostered";
  }[] = [];

  for (const dp of draftPicks ?? []) {
    const owner = (dp as any).owners;
    const season = (dp as any).seasons;
    if (owner && season) {
      ownershipEvents.push({
        year: season.year,
        ownerId: owner.id,
        ownerName: owner.name,
        type: "drafted",
      });
    }
  }

  // Add unique lineup appearances per season/owner
  const lineupOwnerYears = new Set<string>();
  for (const l of allGames) {
    const matchup = l.matchups as any;
    const year = matchup?.seasons?.year ?? 0;
    const key = `${year}-${l.owner_id}`;
    if (!lineupOwnerYears.has(key)) {
      lineupOwnerYears.add(key);
      // Only add if not already in draft picks for same year/owner
      const alreadyDrafted = ownershipEvents.some(
        (e) => e.year === year && e.ownerId === l.owner_id
      );
      if (!alreadyDrafted) {
        ownershipEvents.push({
          year,
          ownerId: l.owner_id,
          ownerName: ownerMap.get(l.owner_id)?.name ?? "Unknown",
          type: "rostered",
        });
      }
    }
  }

  ownershipEvents.sort((a, b) => a.year - b.year);

  // Keeper value — find most recent draft pick for this player
  const mostRecentPick = (draftPicks ?? [])[0] as any;
  let keeperInfo: ReturnType<typeof getKeeperInfo> | null = null;
  if (mostRecentPick) {
    const draftYear = mostRecentPick.seasons?.year;
    if (draftYear) {
      keeperInfo = getKeeperInfo({
        originalRound: mostRecentPick.round,
        draftYear,
        currentYear: 2026,
        sourceType: "draft",
      });
    }
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Back nav */}
      <a href="/players" className="text-xs text-muted hover:text-accent">
        &larr; All Players
      </a>

      {/* Player header */}
      <div className="flex items-center gap-4">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-lg ${
            POS_BADGE[player.position] ?? ""
          }`}
        >
          {player.position}
        </div>
        <div>
          <h1 className="text-3xl font-black">{player.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded ${
                POS_BADGE[player.position] ?? ""
              }`}
            >
              {player.position}
            </span>
            <span className="text-sm text-muted">
              {player.nfl_team ?? "Free Agent"}
            </span>
            {player.bye_week && (
              <span className="text-xs text-muted">Bye: {player.bye_week}</span>
            )}
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                player.is_active
                  ? "bg-accent/20 text-accent"
                  : "bg-danger/20 text-danger"
              }`}
            >
              {player.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Keeper Value */}
      {keeperInfo && keeperInfo.eligible && (
        <div className="bg-card border border-accent/30 rounded-xl p-4">
          <h2 className="text-sm font-bold text-accent mb-2">Keeper Value</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-black">{keeperInfo.label}</div>
              <div className="text-[10px] text-muted uppercase">Status</div>
            </div>
            <div>
              <div className="text-lg font-black">Rd {keeperInfo.roundCost}</div>
              <div className="text-[10px] text-muted uppercase">Cost</div>
            </div>
            <div>
              <div className="text-lg font-black">{keeperInfo.yearsRemaining}</div>
              <div className="text-[10px] text-muted uppercase">Years Left</div>
            </div>
          </div>
          {mostRecentPick && (
            <p className="text-[10px] text-muted mt-2 text-center">
              On {(mostRecentPick.owners as any)?.name ?? "Unknown"}&apos;s roster
              (drafted {mostRecentPick.seasons?.year}, Rd {mostRecentPick.round})
            </p>
          )}
        </div>
      )}

      {/* Draft History */}
      {(draftPicks ?? []).length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Draft History</h2>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                  <th className="text-left px-4 py-2">Year</th>
                  <th className="text-center px-3 py-2">Rd</th>
                  <th className="text-center px-3 py-2">Pick</th>
                  <th className="text-left px-3 py-2">Drafted By</th>
                  <th className="text-center px-3 py-2">Keeper</th>
                </tr>
              </thead>
              <tbody>
                {(draftPicks ?? []).map((dp: any) => (
                  <tr
                    key={dp.id}
                    className="border-b border-border/20 hover:bg-card-hover/30"
                  >
                    <td className="px-4 py-2 text-sm font-bold">
                      {dp.seasons?.year ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-sm text-center">{dp.round}</td>
                    <td className="px-3 py-2 text-sm text-center font-mono text-muted">
                      {dp.overall_pick}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {dp.owners?.id ? (
                        <a
                          href={`/owners/${dp.owners.id}`}
                          className="hover:text-accent"
                        >
                          {dp.owners.name}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {dp.is_keeper && dp.keeper_year ? (
                        <span className="keeper-badge">K{dp.keeper_year}</span>
                      ) : (
                        <span className="text-muted text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Fantasy Performance */}
      {allGames.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Fantasy Performance</h2>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatBox
              label="Games (Starter)"
              value={`${allGames.length} (${starterGames.length})`}
            />
            <StatBox
              label="Total Points"
              value={totalPoints.toFixed(1)}
            />
            <StatBox
              label="Avg PPG"
              value={avgPpg.toFixed(1)}
            />
            <StatBox
              label="Best Game"
              value={bestGame ? bestGame.points.toFixed(1) : "—"}
              subtitle={
                bestGame
                  ? `${bestGame.year} Wk ${bestGame.week} (${bestGame.ownerName})`
                  : undefined
              }
              highlight={!!bestGame}
            />
          </div>

          {/* Season breakdown */}
          {seasonBreakdown.length > 1 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                    <th className="text-left px-4 py-2">Season</th>
                    <th className="text-center px-3 py-2">Games</th>
                    <th className="text-center px-3 py-2">Starts</th>
                    <th className="text-right px-3 py-2">Total Pts</th>
                    <th className="text-right px-3 py-2">PPG</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonBreakdown.map((s) => (
                    <tr
                      key={s.year}
                      className="border-b border-border/20 hover:bg-card-hover/30"
                    >
                      <td className="px-4 py-2 text-sm font-bold">{s.year}</td>
                      <td className="px-3 py-2 text-sm text-center">{s.games}</td>
                      <td className="px-3 py-2 text-sm text-center">
                        {s.starterGames}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-mono">
                        {s.points.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-mono">
                        {s.starterGames > 0
                          ? (s.starterPoints / s.starterGames).toFixed(1)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Ownership Timeline */}
      {ownershipEvents.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-3">Ownership History</h2>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="space-y-3">
              {ownershipEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-12 text-sm font-bold text-muted">{e.year}</div>
                  <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                  <div className="flex-1 text-sm">
                    <a
                      href={`/owners/${e.ownerId}`}
                      className="font-semibold hover:text-accent"
                    >
                      {e.ownerName}
                    </a>
                    <span className="text-muted text-xs ml-2">
                      {e.type === "drafted" ? "Drafted" : "Rostered"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Empty state if no data at all */}
      {(draftPicks ?? []).length === 0 && allGames.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted text-sm">
          No league history found for this player.
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-card border rounded-xl p-3 text-center ${
        highlight ? "border-gold/30" : "border-border"
      }`}
    >
      <div className={`text-lg font-black ${highlight ? "text-gold" : ""}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted uppercase tracking-wider font-semibold">
        {label}
      </div>
      {subtitle && (
        <div className="text-[9px] text-muted mt-0.5">{subtitle}</div>
      )}
    </div>
  );
}
