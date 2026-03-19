"use client";

import { useState, useEffect } from "react";

interface PlayerData {
  player: { id: number; name: string; position: string; nfl_team: string | null; bye_week: number | null; is_active: boolean };
  draftHistory: { year: number; round: number; pickInRound: number; overall: number; owner: string; ownerId: string; isKeeper: boolean; keeperYear: number | null }[];
  stats: { totalGames: number; starterGames: number; totalPoints: number; starterPoints: number; avgPpg: number; bestGame: { points: number; year: number; week: number; ownerName: string } | null };
  seasonBreakdown: { year: number; games: number; starts: number; pts: number; startPts: number }[];
  ownership: { year: number; ownerName: string; type: string }[];
  keeperInfo: { eligible: boolean; keeperYear: number; roundCost: number; yearsRemaining: number; lastDraftedBy: string; lastDraftedYear: number; lastDraftedRound: number } | null;
}

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb", RB: "pos-rb", WR: "pos-wr", TE: "pos-te", DEF: "pos-def", K: "pos-def",
};

const POS_GLOW: Record<string, string> = {
  QB: "shadow-[0_0_30px_rgba(255,107,138,0.15)]",
  RB: "shadow-[0_0_30px_rgba(77,201,246,0.15)]",
  WR: "shadow-[0_0_30px_rgba(85,221,153,0.15)]",
  TE: "shadow-[0_0_30px_rgba(255,170,51,0.15)]",
  DEF: "shadow-[0_0_30px_rgba(176,136,249,0.15)]",
};

const POS_BORDER: Record<string, string> = {
  QB: "border-qb/30", RB: "border-rb/30", WR: "border-wr/30", TE: "border-te/30", DEF: "border-def/30",
};

const POS_BG: Record<string, string> = {
  QB: "from-qb/10", RB: "from-rb/10", WR: "from-wr/10", TE: "from-te/10", DEF: "from-def/10",
};

const KEEPER_COLORS: Record<number, string> = {
  1: "bg-accent/90 text-background",
  2: "bg-rb/90 text-background",
  3: "bg-warning/90 text-background",
  4: "bg-danger/90 text-white",
};

export function PlayerCardModal({
  playerId,
  onClose,
}: {
  playerId: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<PlayerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "drafts" | "stats">("overview");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch(`/api/players/${playerId}`);
        if (resp.ok) {
          setData(await resp.json());
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [playerId]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const pos = data?.player.position ?? "RB";

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={`bg-card border ${POS_BORDER[pos] ?? "border-border"} rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden ${POS_GLOW[pos] ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted mt-3">Loading player...</p>
          </div>
        ) : !data ? (
          <div className="p-12 text-center text-muted">Player not found</div>
        ) : (
          <>
            {/* Header with position gradient */}
            <div className={`bg-gradient-to-b ${POS_BG[pos] ?? ""} to-transparent p-5 pb-4`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-black px-2.5 py-1 rounded-lg ${POS_BADGE[pos] ?? ""}`}>
                    {pos}
                  </span>
                  <div>
                    <h2 className="text-xl font-black leading-tight">{data.player.name}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      {data.player.nfl_team && (
                        <span className="text-xs text-muted font-medium">{data.player.nfl_team}</span>
                      )}
                      {data.player.bye_week && (
                        <span className="text-[10px] text-muted/60">Bye {data.player.bye_week}</span>
                      )}
                      {!data.player.is_active && (
                        <span className="text-[10px] text-danger font-semibold">Inactive</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none p-1">&times;</button>
              </div>

              {/* Keeper info banner */}
              {data.keeperInfo && (
                <div className={`mt-3 rounded-lg px-3 py-2 ${data.keeperInfo.eligible ? "bg-accent/10 border border-accent/20" : "bg-danger/10 border border-danger/20"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {data.keeperInfo.eligible ? (
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${KEEPER_COLORS[data.keeperInfo.keeperYear] ?? "bg-muted text-background"}`}>
                          K{data.keeperInfo.keeperYear}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded bg-danger text-white">INELIGIBLE</span>
                      )}
                      <span className="text-xs font-semibold">
                        {data.keeperInfo.eligible
                          ? `Round ${data.keeperInfo.roundCost} keeper`
                          : "Cannot be kept"}
                      </span>
                    </div>
                    {data.keeperInfo.eligible && (
                      <span className={`text-[10px] font-semibold ${data.keeperInfo.yearsRemaining <= 1 ? "text-danger" : "text-muted"}`}>
                        {data.keeperInfo.yearsRemaining === 0 ? "Final year" : `${data.keeperInfo.yearsRemaining}yr left`}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted mt-1">
                    Last drafted by {data.keeperInfo.lastDraftedBy} in {data.keeperInfo.lastDraftedYear} (Rd {data.keeperInfo.lastDraftedRound})
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              {(["overview", "drafts", "stats"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    tab === t ? "text-accent border-b-2 border-accent" : "text-muted hover:text-foreground"
                  }`}
                >
                  {t === "overview" ? "Overview" : t === "drafts" ? "Draft History" : "Fantasy Stats"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="overflow-y-auto max-h-[50vh] p-4">
              {tab === "overview" && (
                <div className="space-y-4">
                  {/* Quick stats */}
                  <div className="grid grid-cols-4 gap-2">
                    <MiniStat label="Games" value={String(data.stats.starterGames)} />
                    <MiniStat label="Total Pts" value={data.stats.totalPoints.toLocaleString()} />
                    <MiniStat label="Avg PPG" value={data.stats.avgPpg.toFixed(1)} />
                    <MiniStat label="Drafted" value={`${data.draftHistory.length}x`} />
                  </div>

                  {/* Best game */}
                  {data.stats.bestGame && data.stats.bestGame.points > 0 && (
                    <div className="bg-gold/5 border border-gold/20 rounded-lg p-3">
                      <div className="text-[10px] text-gold font-semibold uppercase tracking-wider">Best Game</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-lg font-black text-gold">{data.stats.bestGame.points.toFixed(1)} pts</span>
                        <span className="text-xs text-muted">
                          {data.stats.bestGame.year} Wk {data.stats.bestGame.week} — {data.stats.bestGame.ownerName}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Recent drafts (last 3) */}
                  {data.draftHistory.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-2">Recent Drafts</div>
                      <div className="space-y-1">
                        {data.draftHistory.slice(0, 3).map((d, i) => (
                          <div key={i} className="flex items-center justify-between bg-background/30 rounded px-3 py-1.5">
                            <span className="text-xs font-bold">{d.year}</span>
                            <span className="text-xs text-muted">Rd {d.round} (#{d.overall})</span>
                            <a href={`/owners/${d.ownerId}`} className="text-xs text-muted hover:text-accent">{d.owner}</a>
                            {d.isKeeper && d.keeperYear && (
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${KEEPER_COLORS[d.keeperYear] ?? "bg-muted text-background"}`}>
                                K{d.keeperYear}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Owners */}
                  {data.ownership.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-2">Ownership</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(data.ownership.map(o => o.ownerName))).map((name) => (
                          <span key={name} className="text-[10px] bg-background/40 px-2 py-1 rounded font-medium">{name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === "drafts" && (
                <div className="space-y-1">
                  {data.draftHistory.length === 0 ? (
                    <p className="text-sm text-muted text-center py-4">No draft history</p>
                  ) : (
                    data.draftHistory.map((d, i) => (
                      <div key={i} className="flex items-center justify-between bg-background/20 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black w-10">{d.year}</span>
                          <div>
                            <span className="text-xs font-semibold">Round {d.round}</span>
                            <span className="text-[10px] text-muted ml-2">Pick {d.pickInRound} (#{d.overall})</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a href={`/owners/${d.ownerId}`} className="text-xs text-muted hover:text-accent">{d.owner}</a>
                          {d.isKeeper && d.keeperYear && (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${KEEPER_COLORS[d.keeperYear] ?? "bg-muted text-background"}`}>
                              K{d.keeperYear}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "stats" && (
                <div className="space-y-4">
                  {data.stats.totalGames === 0 ? (
                    <p className="text-sm text-muted text-center py-4">No game data available</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniStat label="Starter Games" value={String(data.stats.starterGames)} />
                        <MiniStat label="Starter Pts" value={data.stats.starterPoints.toLocaleString()} />
                        <MiniStat label="PPG (starts)" value={data.stats.avgPpg.toFixed(1)} />
                      </div>

                      {data.seasonBreakdown.length > 0 && (
                        <div>
                          <div className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-2">By Season</div>
                          <div className="space-y-1">
                            {data.seasonBreakdown.map((s) => (
                              <div key={s.year} className="flex items-center justify-between bg-background/20 rounded px-3 py-2">
                                <span className="text-xs font-bold w-10">{s.year}</span>
                                <span className="text-[10px] text-muted">{s.starts} starts</span>
                                <span className="text-xs font-mono">{s.startPts.toFixed(1)} pts</span>
                                <span className="text-[10px] text-muted font-mono">
                                  {s.starts > 0 ? (s.startPts / s.starts).toFixed(1) : "0"} ppg
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background/30 rounded-lg p-2 text-center">
      <div className="text-sm font-black">{value}</div>
      <div className="text-[9px] text-muted uppercase tracking-wider">{label}</div>
    </div>
  );
}
