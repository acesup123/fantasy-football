import { createClient } from "@/lib/supabase/server";

interface ChampionRow {
  season_id: number;
  playoff_result: string;
  owners: { name: string };
  seasons: { year: number };
}

interface OwnerStats {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  titles: number;
  seasons: number;
}

export default async function HistoryPage() {
  const supabase = await createClient();

  // Get all champions
  const { data: champRows } = await supabase
    .from("season_results")
    .select("season_id, playoff_result, owners(name), seasons(year)")
    .eq("playoff_result", "champion")
    .order("season_id", { ascending: false });

  const champions = ((champRows ?? []) as unknown as ChampionRow[])
    .sort((a, b) => b.seasons.year - a.seasons.year);

  // Get all runners-up
  const { data: runnerUpRows } = await supabase
    .from("season_results")
    .select("season_id, owners(name), seasons(year)")
    .eq("playoff_result", "runner_up");

  const runnerUpMap = new Map<number, string>();
  for (const r of (runnerUpRows ?? []) as any[]) {
    runnerUpMap.set(r.seasons?.year, r.owners?.name);
  }

  // Get all season results for all-time standings
  const { data: allResults } = await supabase
    .from("season_results")
    .select("owner_id, wins, losses, ties, points_for, points_against, playoff_result, owners(id, name, is_active)")
    .order("owner_id");

  // Aggregate by owner
  const ownerStatsMap = new Map<string, OwnerStats>();
  for (const r of (allResults ?? []) as any[]) {
    const ownerId = r.owner_id;
    const ownerName = r.owners?.name ?? "Unknown";
    if (!ownerStatsMap.has(ownerId)) {
      ownerStatsMap.set(ownerId, {
        id: ownerId,
        name: ownerName,
        wins: 0, losses: 0, ties: 0,
        pointsFor: 0, pointsAgainst: 0,
        titles: 0, seasons: 0,
      });
    }
    const s = ownerStatsMap.get(ownerId)!;
    s.wins += r.wins ?? 0;
    s.losses += r.losses ?? 0;
    s.ties += r.ties ?? 0;
    s.pointsFor += Number(r.points_for ?? 0);
    s.pointsAgainst += Number(r.points_against ?? 0);
    if (r.playoff_result === "champion") s.titles++;
    s.seasons++;
  }

  const allTimeStandings = Array.from(ownerStatsMap.values())
    .filter((s) => s.seasons > 0)
    .sort((a, b) => {
      const winPctA = a.wins / (a.wins + a.losses + a.ties || 1);
      const winPctB = b.wins / (b.wins + b.losses + b.ties || 1);
      return winPctB - winPctA;
    });

  const latestChamp = champions[0] ?? null;
  const pastChamps = champions.slice(1);

  return (
    <div className="space-y-12">
      {/* Page header */}
      <div>
        <h1 className="text-4xl font-black tracking-tight">League History</h1>
        <p className="text-muted text-sm mt-1 font-semibold">16 seasons of BANL history</p>
      </div>

      {/* Trophy Case */}
      <section>
        <div className="section-header">
          <h2 className="text-xl font-black uppercase tracking-wide">&#127942; Trophy Case</h2>
        </div>

        {/* Latest champion — featured large */}
        {latestChamp && (
          <div className="champion-card-featured rounded-2xl p-8 mb-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="trophy-display text-7xl float-animation flex-shrink-0">
                <span>&#127942;</span>
              </div>
              <div className="text-center md:text-left">
                <div className="text-[10px] uppercase tracking-[0.2em] text-gold/80 font-bold mb-1">
                  Reigning Champion &middot; {latestChamp.seasons.year}
                </div>
                <div className="text-4xl md:text-5xl font-black text-gold gold-pulse">
                  {latestChamp.owners.name}
                </div>
                <div className="text-sm text-muted mt-2">
                  defeated <span className="text-foreground font-semibold">{runnerUpMap.get(latestChamp.seasons.year) ?? "---"}</span> in the championship
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Past champions grid */}
        {pastChamps.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {pastChamps.map((c) => (
              <div key={c.seasons.year} className="champion-card rounded-xl p-4 text-center">
                <div className="text-2xl mb-1">&#127942;</div>
                <div className="text-[10px] text-muted font-bold uppercase tracking-wider">{c.seasons.year}</div>
                <div className="text-sm font-black mt-1 text-gold">{c.owners.name}</div>
                <div className="text-[10px] text-muted mt-1">
                  def. <span className="text-foreground/70">{runnerUpMap.get(c.seasons.year) ?? "---"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All-time standings */}
      <section>
        <div className="section-header">
          <h2 className="text-xl font-black uppercase tracking-wide">All-Time Standings</h2>
        </div>
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th className="text-left w-12">#</th>
                  <th className="text-left">Owner</th>
                  <th className="text-center">W</th>
                  <th className="text-center">L</th>
                  <th className="text-center">T</th>
                  <th className="text-left" style={{ minWidth: "140px" }}>Win%</th>
                  <th className="text-right">PF</th>
                  <th className="text-right">PA</th>
                  <th className="text-center">Titles</th>
                  <th className="text-center">Yrs</th>
                </tr>
              </thead>
              <tbody>
                {allTimeStandings.map((s, i) => {
                  const total = s.wins + s.losses + s.ties;
                  const winPct = total > 0 ? (s.wins / total) : 0;
                  const rank = i + 1;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className={`rank-badge ${rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other"}`} style={{ width: "1.5rem", height: "1.5rem", fontSize: "0.7rem" }}>
                          {rank}
                        </div>
                      </td>
                      <td className="font-bold">
                        <a href={`/owners/${s.id}`} className="hover:text-accent transition-colors">
                          {s.name}
                        </a>
                      </td>
                      <td className="text-center font-mono font-bold text-accent">{s.wins}</td>
                      <td className="text-center font-mono text-muted">{s.losses}</td>
                      <td className="text-center font-mono text-muted">{s.ties}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-sm w-12">
                            {(winPct * 100).toFixed(1)}%
                          </span>
                          <div className="win-bar-track flex-1">
                            <div
                              className={`win-bar-fill ${rank === 1 ? "win-bar-fill-gold" : ""}`}
                              style={{ width: `${winPct * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="text-right font-mono">
                        {s.pointsFor.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="text-right font-mono text-muted">
                        {s.pointsAgainst.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="text-center">
                        {s.titles > 0 ? (
                          <span className="text-gold font-black">
                            {Array.from({ length: s.titles }).map((_, j) => (
                              <span key={j}>&#127942;</span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-muted/40">0</span>
                        )}
                      </td>
                      <td className="text-center text-muted font-mono">{s.seasons}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Explore more */}
      <section>
        <div className="section-header">
          <h2 className="text-xl font-black uppercase tracking-wide">Explore</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <a href="/history/records" className="nav-card nav-card-gold group">
            <div className="text-2xl mb-2">&#128200;</div>
            <h3 className="font-black text-gold group-hover:underline underline-offset-4">Records &amp; Stats</h3>
            <p className="text-xs text-muted mt-1">Top scores, biggest blowouts, win streaks, and more</p>
          </a>
          <a href="/history/head-to-head" className="nav-card nav-card-accent group">
            <div className="text-2xl mb-2">&#9876;&#65039;</div>
            <h3 className="font-black text-accent group-hover:underline underline-offset-4">Head-to-Head</h3>
            <p className="text-xs text-muted mt-1">All-time records between every pair of owners</p>
          </a>
          <a href="/history/drafts" className="nav-card nav-card-rb group">
            <div className="text-2xl mb-2">&#128203;</div>
            <h3 className="font-black text-rb group-hover:underline underline-offset-4">Draft History</h3>
            <p className="text-xs text-muted mt-1">Browse every draft board from every season</p>
          </a>
          <a href="/trades" className="nav-card nav-card-warning group">
            <div className="text-2xl mb-2">&#128260;</div>
            <h3 className="font-black text-warning group-hover:underline underline-offset-4">Trade Center</h3>
            <p className="text-xs text-muted mt-1">Propose trades, view history, track pick ownership</p>
          </a>
        </div>
      </section>
    </div>
  );
}
