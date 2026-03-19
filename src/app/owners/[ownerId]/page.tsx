import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb", RB: "pos-rb", WR: "pos-wr", TE: "pos-te", DEF: "pos-def", K: "pos-def",
};

export default async function OwnerProfilePage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = await params;
  const supabase = await createClient();

  // Get owner
  const { data: owner } = await supabase
    .from("owners")
    .select("*")
    .eq("id", ownerId)
    .single();

  if (!owner) return notFound();

  // Get all season results for this owner
  const { data: results } = await supabase
    .from("season_results")
    .select("*, seasons(year)")
    .eq("owner_id", ownerId)
    .order("season_id", { ascending: false });

  const seasons = (results ?? []).sort(
    (a: any, b: any) => (b.seasons?.year ?? 0) - (a.seasons?.year ?? 0)
  );

  // Aggregate stats
  const totals = seasons.reduce(
    (acc, s: any) => ({
      wins: acc.wins + (s.wins ?? 0),
      losses: acc.losses + (s.losses ?? 0),
      ties: acc.ties + (s.ties ?? 0),
      pf: acc.pf + Number(s.points_for ?? 0),
      pa: acc.pa + Number(s.points_against ?? 0),
      titles: acc.titles + (s.playoff_result === "champion" ? 1 : 0),
      runnerUps: acc.runnerUps + (s.playoff_result === "runner_up" ? 1 : 0),
    }),
    { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, titles: 0, runnerUps: 0 }
  );

  const totalGames = totals.wins + totals.losses + totals.ties;
  const winPct = totalGames > 0 ? ((totals.wins / totalGames) * 100).toFixed(1) : "0";

  // Get head-to-head records from matchups
  const { data: h2hHome } = await supabase
    .from("matchups")
    .select("away_owner_id, winner_owner_id")
    .eq("home_owner_id", ownerId);

  const { data: h2hAway } = await supabase
    .from("matchups")
    .select("home_owner_id, winner_owner_id")
    .eq("away_owner_id", ownerId);

  // Aggregate H2H
  const h2h = new Map<string, { wins: number; losses: number }>();
  for (const m of h2hHome ?? []) {
    const opp = m.away_owner_id;
    if (!h2h.has(opp)) h2h.set(opp, { wins: 0, losses: 0 });
    if (m.winner_owner_id === ownerId) h2h.get(opp)!.wins++;
    else if (m.winner_owner_id) h2h.get(opp)!.losses++;
  }
  for (const m of h2hAway ?? []) {
    const opp = m.home_owner_id;
    if (!h2h.has(opp)) h2h.set(opp, { wins: 0, losses: 0 });
    if (m.winner_owner_id === ownerId) h2h.get(opp)!.wins++;
    else if (m.winner_owner_id) h2h.get(opp)!.losses++;
  }

  // Get opponent names
  const oppIds = Array.from(h2h.keys());
  const { data: opponents } = await supabase
    .from("owners")
    .select("id, name")
    .in("id", oppIds);
  const oppMap = new Map((opponents ?? []).map((o) => [o.id, o.name]));

  // Get draft history — picks this owner made
  const { data: draftPicks } = await supabase
    .from("draft_picks")
    .select("round, overall_pick, is_keeper, keeper_year, players(name, position), seasons(year)")
    .eq("current_owner_id", ownerId)
    .order("season_id", { ascending: false });

  const picks = (draftPicks ?? []).sort(
    (a: any, b: any) => (b.seasons?.year ?? 0) - (a.seasons?.year ?? 0) || a.round - b.round
  );

  // Get top matchup scores
  const { data: topHome } = await supabase
    .from("matchups")
    .select("home_points, week, seasons(year)")
    .eq("home_owner_id", ownerId)
    .order("home_points", { ascending: false })
    .limit(5);

  const { data: topAway } = await supabase
    .from("matchups")
    .select("away_points, week, seasons(year)")
    .eq("away_owner_id", ownerId)
    .order("away_points", { ascending: false })
    .limit(5);

  const topScores = [
    ...(topHome ?? []).map((m: any) => ({ pts: m.home_points, week: m.week, year: m.seasons?.year })),
    ...(topAway ?? []).map((m: any) => ({ pts: m.away_points, week: m.week, year: m.seasons?.year })),
  ]
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 5);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <a href="/owners" className="text-xs text-muted hover:text-accent">
          ← All Owners
        </a>
        <div className="flex items-center gap-4 mt-2">
          <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center text-accent font-black text-xl">
            {owner.name.split(" ").map((n: string) => n[0]).join("")}
          </div>
          <div>
            <h1 className="text-3xl font-black">{owner.name}</h1>
            <p className="text-muted text-sm">
              Since {owner.joined_year}
              {!owner.is_active && " · Inactive"}
              {totals.titles > 0 && (
                <span className="text-gold ml-2">
                  {"🏆".repeat(totals.titles)}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Career Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatBox label="Record" value={`${totals.wins}-${totals.losses}-${totals.ties}`} />
        <StatBox label="Win %" value={`${winPct}%`} />
        <StatBox label="Titles" value={String(totals.titles)} highlight={totals.titles > 0} />
        <StatBox label="Runner-ups" value={String(totals.runnerUps)} />
        <StatBox label="Seasons" value={String(seasons.length)} />
        <StatBox label="Total PF" value={totals.pf.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <StatBox label="Pts/Game" value={totalGames > 0 ? (totals.pf / totalGames).toFixed(1) : "—"} />
      </div>

      {/* Top Scores */}
      <section>
        <h2 className="text-lg font-bold mb-3">Top Weekly Scores</h2>
        <div className="flex gap-3 flex-wrap">
          {topScores.map((s, i) => (
            <div key={i} className={`bg-card border rounded-lg px-4 py-2 text-center ${i === 0 ? "border-gold/30" : "border-border"}`}>
              <div className={`text-lg font-black ${i === 0 ? "text-gold" : ""}`}>{s.pts.toFixed(1)}</div>
              <div className="text-[10px] text-muted">{s.year} Wk {s.week}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Season-by-Season */}
      <section>
        <h2 className="text-lg font-bold mb-3">Season History</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left px-4 py-2">Year</th>
                <th className="text-center px-3 py-2">W</th>
                <th className="text-center px-3 py-2">L</th>
                <th className="text-center px-3 py-2">T</th>
                <th className="text-right px-3 py-2">PF</th>
                <th className="text-right px-3 py-2">PA</th>
                <th className="text-center px-3 py-2">Seed</th>
                <th className="text-center px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s: any) => (
                <tr key={s.id} className="border-b border-border/20 hover:bg-card-hover/30">
                  <td className="px-4 py-2 text-sm font-bold">{s.seasons?.year}</td>
                  <td className="px-3 py-2 text-sm text-center">{s.wins}</td>
                  <td className="px-3 py-2 text-sm text-center">{s.losses}</td>
                  <td className="px-3 py-2 text-sm text-center">{s.ties}</td>
                  <td className="px-3 py-2 text-sm text-right font-mono">
                    {Number(s.points_for).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-mono">
                    {Number(s.points_against).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-3 py-2 text-sm text-center">{s.playoff_seed ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-center">
                    {s.playoff_result === "champion" ? (
                      <span className="text-gold font-bold">Champion 🏆</span>
                    ) : s.playoff_result === "runner_up" ? (
                      <span className="text-muted font-semibold">Runner-up</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Head-to-Head */}
      <section>
        <h2 className="text-lg font-bold mb-3">Head-to-Head Records</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left px-4 py-2">Opponent</th>
                <th className="text-center px-3 py-2">W</th>
                <th className="text-center px-3 py-2">L</th>
                <th className="text-center px-3 py-2">Win%</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(h2h.entries())
                .map(([oppId, record]) => ({
                  oppId,
                  name: oppMap.get(oppId) ?? "Unknown",
                  ...record,
                }))
                .sort((a, b) => {
                  const wpA = a.wins / (a.wins + a.losses || 1);
                  const wpB = b.wins / (b.wins + b.losses || 1);
                  return wpB - wpA;
                })
                .map((r) => {
                  const total = r.wins + r.losses;
                  const wp = total > 0 ? ((r.wins / total) * 100).toFixed(0) : "—";
                  const isWinning = r.wins > r.losses;
                  const isLosing = r.losses > r.wins;
                  return (
                    <tr key={r.oppId} className="border-b border-border/20 hover:bg-card-hover/30">
                      <td className="px-4 py-2 text-sm">
                        <a href={`/owners/${r.oppId}`} className="hover:text-accent">
                          {r.name}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-sm text-center font-mono">{r.wins}</td>
                      <td className="px-3 py-2 text-sm text-center font-mono">{r.losses}</td>
                      <td className={`px-3 py-2 text-sm text-center font-bold ${
                        isWinning ? "text-accent" : isLosing ? "text-danger" : "text-muted"
                      }`}>
                        {wp}%
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Draft History */}
      <section>
        <h2 className="text-lg font-bold mb-3">Draft History</h2>
        <div className="bg-card border border-border rounded-xl overflow-hidden max-h-[500px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-card">
              <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                <th className="text-left px-4 py-2">Year</th>
                <th className="text-center px-3 py-2">Rd</th>
                <th className="text-center px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-center px-3 py-2">Pos</th>
                <th className="text-center px-3 py-2">Keeper</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p: any, i: number) => (
                <tr key={i} className="border-b border-border/20 hover:bg-card-hover/30">
                  <td className="px-4 py-1.5 text-xs font-bold">{p.seasons?.year}</td>
                  <td className="px-3 py-1.5 text-xs text-center">{p.round}</td>
                  <td className="px-3 py-1.5 text-xs text-center font-mono text-muted">{p.overall_pick}</td>
                  <td className="px-3 py-1.5 text-xs font-medium">{p.players?.name ?? "—"}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${POS_BADGE[p.players?.position] ?? ""}`}>
                      {p.players?.position ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {p.is_keeper && p.keeper_year ? (
                      <span className="keeper-badge">K{p.keeper_year}</span>
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
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-card border rounded-xl p-3 text-center ${highlight ? "border-gold/30" : "border-border"}`}>
      <div className={`text-lg font-black ${highlight ? "text-gold" : ""}`}>{value}</div>
      <div className="text-[10px] text-muted uppercase tracking-wider font-semibold">{label}</div>
    </div>
  );
}
