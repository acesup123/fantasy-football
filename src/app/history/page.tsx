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

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">League History</h1>

      {/* Champions */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Champions</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {champions.map((c) => (
            <div
              key={c.seasons.year}
              className="bg-card border border-gold/20 rounded-xl p-4 text-center champion-glow"
            >
              <div className="text-xs text-muted">{c.seasons.year}</div>
              <div className="text-sm font-black mt-1 text-gold">{c.owners.name}</div>
              <div className="text-[10px] text-muted mt-0.5">
                def. {runnerUpMap.get(c.seasons.year) ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* All-time standings */}
      <section>
        <h2 className="text-xl font-semibold mb-4">All-Time Standings</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-[10px] text-muted uppercase tracking-wider">
                <th className="text-left px-4 py-2">#</th>
                <th className="text-left px-4 py-2">Owner</th>
                <th className="text-center px-4 py-2">W</th>
                <th className="text-center px-4 py-2">L</th>
                <th className="text-center px-4 py-2">T</th>
                <th className="text-center px-4 py-2">Win%</th>
                <th className="text-right px-4 py-2">PF</th>
                <th className="text-right px-4 py-2">PA</th>
                <th className="text-center px-4 py-2">Titles</th>
                <th className="text-center px-4 py-2">Yrs</th>
              </tr>
            </thead>
            <tbody>
              {allTimeStandings.map((s, i) => {
                const total = s.wins + s.losses + s.ties;
                const winPct = total > 0 ? (s.wins / total) : 0;
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border/20 hover:bg-card-hover transition-colors"
                  >
                    <td className="px-4 py-2 text-sm text-muted">{i + 1}</td>
                    <td className="px-4 py-2 text-sm font-semibold">
                      <a href={`/owners/${s.id}`} className="hover:text-accent">
                        {s.name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-sm text-center">{s.wins}</td>
                    <td className="px-4 py-2 text-sm text-center">{s.losses}</td>
                    <td className="px-4 py-2 text-sm text-center">{s.ties}</td>
                    <td className="px-4 py-2 text-sm text-center font-mono">
                      {(winPct * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-sm text-right font-mono">
                      {s.pointsFor.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-4 py-2 text-sm text-right font-mono">
                      {s.pointsAgainst.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-4 py-2 text-sm text-center">
                      {s.titles > 0 ? (
                        <span className="text-gold font-bold">{s.titles}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-center text-muted">{s.seasons}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <a href="/history/records" className="block bg-card border border-gold/20 rounded-xl p-4 hover:bg-card-hover transition-colors">
          <h3 className="font-semibold text-gold">Records & Stats</h3>
          <p className="text-xs text-muted mt-1">Top scores, biggest blowouts, win streaks, and more</p>
        </a>
        <a href="/history/head-to-head" className="block bg-card border border-border rounded-xl p-4 hover:bg-card-hover transition-colors">
          <h3 className="font-semibold text-accent">Head-to-Head</h3>
          <p className="text-xs text-muted mt-1">All-time records between every pair of owners</p>
        </a>
        <a href="/history/drafts" className="block bg-card border border-border rounded-xl p-4 hover:bg-card-hover transition-colors">
          <h3 className="font-semibold text-rb">Draft History</h3>
          <p className="text-xs text-muted mt-1">Browse every draft board from every season</p>
        </a>
        <a href="/trades" className="block bg-card border border-border rounded-xl p-4 hover:bg-card-hover transition-colors">
          <h3 className="font-semibold text-warning">Trade Center</h3>
          <p className="text-xs text-muted mt-1">Propose trades, view history, track pick ownership</p>
        </a>
      </div>
    </div>
  );
}
