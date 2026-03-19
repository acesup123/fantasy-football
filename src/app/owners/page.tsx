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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Owners</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((owner) => {
          const stats = statsMap.get(owner.id);
          const totalGames = stats ? stats.wins + stats.losses + stats.ties : 0;
          const winPct = totalGames > 0 ? ((stats!.wins / totalGames) * 100).toFixed(1) : "—";
          const ppg = stats && stats.seasons > 0
            ? (stats.pointsFor / (totalGames || 1)).toFixed(1)
            : "—";

          return (
            <a
              key={owner.id}
              href={`/owners/${owner.id}`}
              className={`block bg-card border rounded-xl p-4 hover:bg-card-hover transition-all hover:-translate-y-0.5 ${
                owner.is_active ? "border-border" : "border-border/50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-xs">
                  {owner.name.split(" ").map((n: string) => n[0]).join("")}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{owner.name}</h3>
                  <p className="text-[10px] text-muted">
                    Since {owner.joined_year}
                    {!owner.is_active && " · Inactive"}
                    {stats && stats.titles > 0 && (
                      <span className="text-gold ml-1">
                        {"🏆".repeat(stats.titles)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-bold">
                    {stats ? `${stats.wins}-${stats.losses}` : "—"}
                  </div>
                  <div className="text-[10px] text-muted uppercase">Record</div>
                </div>
                <div>
                  <div className="text-sm font-bold">{winPct}{winPct !== "—" ? "%" : ""}</div>
                  <div className="text-[10px] text-muted uppercase">Win%</div>
                </div>
                <div>
                  <div className="text-sm font-bold">{ppg}</div>
                  <div className="text-[10px] text-muted uppercase">Pts/Gm</div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
