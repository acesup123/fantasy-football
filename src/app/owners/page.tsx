import { createClient } from "@/lib/supabase/server";

export default async function OwnersPage() {
  const supabase = await createClient();

  // Get all owners
  const { data: owners } = await supabase
    .from("owners")
    .select("id, name, team_name, joined_year, is_active")
    .order("name");

  // Get aggregated stats per owner
  const { data: results } = await supabase
    .from("season_results")
    .select("owner_id, wins, losses, ties, points_for, playoff_result");

  // Aggregate
  const statsMap = new Map<string, {
    wins: number; losses: number; ties: number;
    pointsFor: number; titles: number; seasons: number;
  }>();

  for (const r of (results ?? []) as any[]) {
    if (!statsMap.has(r.owner_id)) {
      statsMap.set(r.owner_id, { wins: 0, losses: 0, ties: 0, pointsFor: 0, titles: 0, seasons: 0 });
    }
    const s = statsMap.get(r.owner_id)!;
    s.wins += r.wins ?? 0;
    s.losses += r.losses ?? 0;
    s.ties += r.ties ?? 0;
    s.pointsFor += Number(r.points_for ?? 0);
    if (r.playoff_result === "champion") s.titles++;
    s.seasons++;
  }

  // Sort: active first, then by win%
  const sorted = [...(owners ?? [])].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const sa = statsMap.get(a.id);
    const sb = statsMap.get(b.id);
    const wpA = sa ? sa.wins / (sa.wins + sa.losses + sa.ties || 1) : 0;
    const wpB = sb ? sb.wins / (sb.wins + sb.losses + sb.ties || 1) : 0;
    return wpB - wpA;
  });

  // Track rank among active owners
  let activeRank = 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-black tracking-tight">The Owners</h1>
        <p className="text-muted text-sm mt-1 font-semibold">Ranked by all-time win percentage</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sorted.map((owner) => {
          const stats = statsMap.get(owner.id);
          const totalGames = stats ? stats.wins + stats.losses + stats.ties : 0;
          const winPct = totalGames > 0 ? stats!.wins / totalGames : 0;
          const winPctDisplay = totalGames > 0 ? (winPct * 100).toFixed(1) : "---";
          const ppg = stats && stats.seasons > 0
            ? (stats.pointsFor / (totalGames || 1)).toFixed(1)
            : "---";

          const rank = owner.is_active ? ++activeRank : null;
          const cardClass = !owner.is_active
            ? "owner-card owner-card-inactive"
            : rank === 1
              ? "owner-card owner-card-1"
              : rank === 2
                ? "owner-card owner-card-2"
                : rank === 3
                  ? "owner-card owner-card-3"
                  : "owner-card owner-card-default";

          return (
            <a
              key={owner.id}
              href={`/owners/${owner.id}`}
              className={`block p-5 ${cardClass}`}
            >
              {/* Top row: Rank + Name + Titles */}
              <div className="flex items-start gap-3 mb-4">
                {rank ? (
                  <div className={`rank-badge ${rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other"}`}>
                    {rank}
                  </div>
                ) : (
                  <div className="rank-badge rank-other" style={{ opacity: 0.4 }}>
                    --
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-black text-base truncate">{owner.name}</h3>
                  <p className="text-xs font-bold text-qb truncate mt-0.5">
                    {owner.team_name || "No Team Name"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted">Since {owner.joined_year}</span>
                    {!owner.is_active && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-danger bg-danger/10 px-1.5 py-0.5 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
                {stats && stats.titles > 0 && (
                  <div className="flex-shrink-0 text-right">
                    <div className="text-2xl leading-none">
                      {Array.from({ length: Math.min(stats.titles, 5) }).map((_, i) => (
                        <span key={i} className="inline-block" style={{ marginLeft: i > 0 ? "-4px" : "0" }}>
                          &#127942;
                        </span>
                      ))}
                    </div>
                    <div className="text-[9px] text-gold font-bold mt-0.5 uppercase tracking-wider">
                      {stats.titles}x Champ
                    </div>
                  </div>
                )}
              </div>

              {/* Win% bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-muted uppercase tracking-wider font-bold">Win Rate</span>
                  <span className="text-lg font-black font-mono">
                    {winPctDisplay}{winPctDisplay !== "---" ? "%" : ""}
                  </span>
                </div>
                <div className="win-bar-track" style={{ height: "8px" }}>
                  <div
                    className={`win-bar-fill ${rank === 1 ? "win-bar-fill-gold" : ""}`}
                    style={{ width: `${winPct * 100}%` }}
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-background/30 rounded-lg py-2">
                  <div className="text-base font-black">
                    {stats ? `${stats.wins}-${stats.losses}` : "---"}
                  </div>
                  <div className="text-[9px] text-muted uppercase tracking-wider font-bold">Record</div>
                </div>
                <div className="text-center bg-background/30 rounded-lg py-2">
                  <div className="text-base font-black font-mono">{ppg}</div>
                  <div className="text-[9px] text-muted uppercase tracking-wider font-bold">Pts/Gm</div>
                </div>
                <div className="text-center bg-background/30 rounded-lg py-2">
                  <div className="text-base font-black">{stats?.seasons ?? 0}</div>
                  <div className="text-[9px] text-muted uppercase tracking-wider font-bold">Seasons</div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
