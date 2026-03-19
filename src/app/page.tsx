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

  // Get most recent champion
  const { data: latestChamp } = await supabase
    .from("season_results")
    .select("seasons(year), owners(name)")
    .eq("playoff_result", "champion")
    .order("season_id", { ascending: false })
    .limit(1)
    .single();

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-16 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent rounded-3xl" />
        <div className="relative">
          <div className="text-6xl font-black tracking-tighter mb-3 bg-gradient-to-r from-accent via-foreground to-accent bg-clip-text text-transparent">
            BANL Fantasy Football
          </div>
          <p className="text-muted text-lg font-medium tracking-wide">
            Draft. Trade. Dominate.
          </p>
          {latestChamp && (
            <p className="text-sm text-gold mt-2 font-semibold">
              Reigning Champion: {(latestChamp.owners as any)?.name} ({(latestChamp.seasons as any)?.year})
            </p>
          )}
          <div className="flex items-center justify-center gap-3 mt-6">
            <a href="/draft" className="btn-primary px-6 py-2.5 text-sm inline-block">
              Enter Draft Room
            </a>
            <a href="/trades" className="btn-secondary px-6 py-2.5 text-sm inline-block">
              Trade Center
            </a>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <QuickAction href="/draft" title="Draft Room" description="Live draft board with real-time picks and trades" accent="accent" icon="🏈" />
        <QuickAction href="/keepers" title="Keeper Management" description="Elect keepers, view costs, and track eligibility" accent="keeper" icon="🔒" />
        <QuickAction href="/trades" title="Trade Center" description="Propose trades, track history, manage picks year-round" accent="warning" icon="🔄" />
        <QuickAction href="/owners" title="Owner Profiles" description="Career stats, draft history, head-to-head records" accent="qb" icon="👥" />
        <QuickAction href="/history" title="League History" description="Champions, records, and all-time standings" accent="wr" icon="🏆" />
        <QuickAction href="/admin" title="Admin" description="Manage seasons, import data, league settings" accent="def" icon="⚙️" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Seasons" value={String(seasonCount)} />
        <StatCard label="Total Trades" value={String(tradeCount)} />
        <StatCard label="Players Drafted" value={draftPickCount.toLocaleString()} />
        <StatCard label="Active Owners" value={String(activeOwners)} />
      </div>

      {/* Quick links */}
      <section>
        <h2 className="text-lg font-bold mb-3">Quick Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <a href="/admin/lottery" className="block bg-card border border-accent/20 rounded-xl p-4 hover:bg-card-hover transition-all">
            <div className="font-bold text-sm text-accent">🎰 Draft Lottery</div>
            <p className="text-xs text-muted mt-1">Run the weighted lottery for 2026 draft order</p>
          </a>
          <a href="/history" className="block bg-card border border-border rounded-xl p-4 hover:bg-card-hover transition-all">
            <div className="font-bold text-sm text-wr">🏆 League History</div>
            <p className="text-xs text-muted mt-1">Champions, all-time records, and head-to-head</p>
          </a>
        </div>
      </section>
    </div>
  );
}

function QuickAction({ href, title, description, accent, icon }: {
  href: string; title: string; description: string; accent: string; icon: string;
}) {
  return (
    <a href={href} className="group block bg-card border border-border rounded-xl p-5 hover:bg-card-hover hover:border-border-bright transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <span className="text-xl">{icon}</span>
        <div>
          <h3 className={`font-bold text-sm text-${accent} group-hover:underline underline-offset-2`}>{title}</h3>
          <p className="text-muted text-xs mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </a>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <div className="text-2xl font-black text-foreground">{value}</div>
      <div className="text-[10px] text-muted uppercase tracking-wider font-semibold mt-0.5">{label}</div>
    </div>
  );
}
