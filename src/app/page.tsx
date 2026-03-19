import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();

  const [seasonsRes, ownersRes, picksRes, tradesRes] = await Promise.all([
    supabase.from("seasons").select("id").order("year", { ascending: false }),
    supabase.from("owners").select("id, is_active"),
    supabase.from("draft_picks").select("id", { count: "exact", head: true }),
    supabase.from("trades").select("id", { count: "exact", head: true }),
  ]);

  const seasonCount = seasonsRes.data?.length ?? 0;
  const activeOwners = ownersRes.data?.filter((o) => o.is_active).length ?? 0;
  const draftPickCount = picksRes.count ?? 0;
  const tradeCount = tradesRes.count ?? 0;

  // Get most recent champion — order by season year, not ID
  const { data: allChamps } = await supabase
    .from("season_results")
    .select("seasons(year), owners(name)")
    .eq("playoff_result", "champion");

  const latestChamp = (allChamps ?? [])
    .sort((a: any, b: any) => (b.seasons?.year ?? 0) - (a.seasons?.year ?? 0))[0] ?? null;

  // Get top 5 owners by all-time win% for power rankings
  const { data: allResults } = await supabase
    .from("season_results")
    .select("owner_id, wins, losses, ties, playoff_result, owners(name, team_name)");

  const ownerStatsMap = new Map<string, {
    name: string; teamName: string; wins: number; losses: number; ties: number; titles: number;
  }>();
  for (const r of (allResults ?? []) as any[]) {
    const id = r.owner_id;
    if (!ownerStatsMap.has(id)) {
      ownerStatsMap.set(id, {
        name: r.owners?.name ?? "Unknown",
        teamName: r.owners?.team_name ?? "",
        wins: 0, losses: 0, ties: 0, titles: 0,
      });
    }
    const s = ownerStatsMap.get(id)!;
    s.wins += r.wins ?? 0;
    s.losses += r.losses ?? 0;
    s.ties += r.ties ?? 0;
    if (r.playoff_result === "champion") s.titles++;
  }

  const powerRankings = Array.from(ownerStatsMap.entries())
    .map(([id, s]) => {
      const total = s.wins + s.losses + s.ties;
      return { id, ...s, total, winPct: total > 0 ? s.wins / total : 0 };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.winPct - a.winPct)
    .slice(0, 5);

  // Fun team names for "Team Name of the Day"
  const allTeamNames = Array.from(ownerStatsMap.values())
    .map((s) => s.teamName)
    .filter(Boolean);
  const todayIndex = Math.floor(Date.now() / 86400000) % (allTeamNames.length || 1);
  const teamNameOfDay = allTeamNames[todayIndex] ?? "BANL Fantasy Football";

  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden hero-animated-bg">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/90" />
        <div className="relative text-center py-20 px-4">
          <div className="inline-block mb-4 px-4 py-1 rounded-full border border-accent/30 bg-accent/5 text-accent text-xs font-bold uppercase tracking-widest">
            Est. {seasonCount > 0 ? `${new Date().getFullYear() - seasonCount + 1}` : "2020"} &middot; 12 Teams &middot; Superflex Keeper
          </div>

          <h1 className="text-7xl md:text-8xl font-black tracking-tighter mb-2">
            <span className="bg-gradient-to-r from-accent via-foreground via-60% to-qb bg-clip-text text-transparent">
              BANL
            </span>
          </h1>
          <p className="text-xl md:text-2xl font-bold text-foreground/80 tracking-wide mb-1">
          </p>
          <p className="text-muted text-sm font-semibold tracking-widest uppercase">
            Draft. Trade. Dominate.
          </p>

          {/* Reigning Champion */}
          {latestChamp && (
            <div className="mt-8 inline-flex items-center gap-3 glass-card rounded-2xl px-6 py-4">
              <div className="trophy-display text-4xl float-animation">
                <span>&#127942;</span>
              </div>
              <div className="text-left">
                <div className="text-[10px] uppercase tracking-widest text-gold font-bold">Reigning Champion</div>
                <div className="text-xl font-black text-gold">
                  {(latestChamp.owners as any)?.name}
                </div>
                <div className="text-xs text-muted font-semibold">
                  {(latestChamp.seasons as any)?.year} Season
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-4 mt-8">
            <a href="/draft" className="btn-primary px-8 py-3 text-base font-black inline-block">
              Enter Draft Room
            </a>
            <a href="/trades" className="btn-secondary px-8 py-3 text-base inline-block">
              Trade Center
            </a>
          </div>
        </div>
      </div>

      {/* Team Name of the Day */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 glass-card rounded-full px-6 py-2.5">
          <span className="text-xs text-muted font-bold uppercase tracking-wider">Team Name of the Day:</span>
          <span className="text-sm font-black text-qb">{teamNameOfDay}</span>
        </div>
      </div>

      {/* Stats row — big and bold */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-value">{seasonCount}</div>
          <div className="stat-label">Seasons</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{tradeCount}</div>
          <div className="stat-label">Total Trades</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{draftPickCount.toLocaleString()}</div>
          <div className="stat-label">Players Drafted</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{activeOwners}</div>
          <div className="stat-label">Active Owners</div>
        </div>
      </div>

      {/* Two-column: Power Rankings + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Power Rankings */}
        <div className="lg:col-span-2">
          <div className="section-header">
            <h2 className="text-lg font-black uppercase tracking-wide">Power Rankings</h2>
          </div>
          <div className="glass-card rounded-2xl p-5 space-y-3">
            {powerRankings.map((owner, i) => (
              <a key={owner.id} href={`/owners/${owner.id}`} className="flex items-center gap-3 group">
                <div className={`rank-badge ${i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : "rank-other"}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold group-hover:text-accent transition-colors truncate">
                      {owner.name}
                    </span>
                    <span className="text-sm font-mono font-black text-foreground">
                      {(owner.winPct * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="win-bar-track">
                    <div
                      className={`win-bar-fill ${i === 0 ? "win-bar-fill-gold" : ""}`}
                      style={{ width: `${owner.winPct * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-muted truncate">{owner.teamName}</span>
                    <span className="text-[10px] text-muted font-mono">{owner.wins}-{owner.losses}{owner.ties > 0 ? `-${owner.ties}` : ""}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-3">
          <div className="section-header">
            <h2 className="text-lg font-black uppercase tracking-wide">Command Center</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NavCard href="/draft" title="Draft Room" description="Live draft board with real-time picks and trades" color="accent" icon="&#127944;" />
            <NavCard href="/keepers" title="Keeper Mgmt" description="Elect keepers, view costs, track eligibility" color="keeper" icon="&#128274;" />
            <NavCard href="/trades" title="Trade Center" description="Propose trades, manage picks year-round" color="warning" icon="&#128260;" />
            <NavCard href="/owners" title="Owner Profiles" description="Career stats, draft history, head-to-head" color="qb" icon="&#128081;" />
            <NavCard href="/history" title="League History" description="Champions, records, all-time standings" color="gold" icon="&#127942;" />
            <NavCard href="/admin" title="League Admin" description="Manage seasons, import data, settings" color="def" icon="&#9881;" />
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a href="/admin/lottery" className="nav-card nav-card-accent group">
          <div className="text-2xl mb-2">&#127920;</div>
          <div className="font-black text-accent text-sm group-hover:underline underline-offset-4">Draft Lottery</div>
          <p className="text-xs text-muted mt-1">Run the weighted lottery for draft order</p>
        </a>
        <a href="/history/records" className="nav-card nav-card-gold group">
          <div className="text-2xl mb-2">&#128200;</div>
          <div className="font-black text-gold text-sm group-hover:underline underline-offset-4">Records &amp; Stats</div>
          <p className="text-xs text-muted mt-1">Top scores, biggest blowouts, win streaks</p>
        </a>
      </div>
    </div>
  );
}

function NavCard({ href, title, description, color, icon }: {
  href: string; title: string; description: string; color: string; icon: string;
}) {
  return (
    <a href={href} className={`nav-card nav-card-${color} group flex items-start gap-4`}>
      <div className="text-3xl flex-shrink-0">{icon}</div>
      <div>
        <h3 className={`font-black text-sm text-${color} group-hover:underline underline-offset-4`}>{title}</h3>
        <p className="text-muted text-xs mt-1 leading-relaxed">{description}</p>
      </div>
    </a>
  );
}
