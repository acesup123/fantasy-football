"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";

interface KeeperPlayer {
  player_id: number;
  player_name: string;
  position: string;
  nfl_team: string | null;
  original_round: number;
  keeper_year: number;
  round_cost: number;
  years_remaining: number;
  eligible: boolean;
  source: "draft" | "free_agent";
  reason?: string;
}

interface OwnerKeepers {
  owner_id: string;
  owner_name: string;
  team_name: string;
  players: KeeperPlayer[];
}

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  DEF: "pos-def",
  K: "pos-def",
};

// K1 = green (plenty of time), K2 = teal, K3 = yellow (getting tight), K4 = red (last year)
const KEEPER_YEAR_STYLES: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: "bg-accent/90", text: "text-background", label: "K1" },
  2: { bg: "bg-rb/90", text: "text-background", label: "K2" },
  3: { bg: "bg-warning/90", text: "text-background", label: "K3" },
  4: { bg: "bg-danger/90", text: "text-white", label: "K4" },
  5: { bg: "bg-muted/40", text: "text-muted", label: "K5" },
};

function KeeperBadge({ year }: { year: number }) {
  const style = KEEPER_YEAR_STYLES[year] ?? KEEPER_YEAR_STYLES[5];
  return (
    <span
      className={`text-[10px] font-black px-2 py-0.5 rounded-md ${style.bg} ${style.text} tracking-wide`}
    >
      {style.label}
      {year === 4 && " FINAL"}
    </span>
  );
}

interface HistoricalKeeper {
  player_name: string;
  position: string;
  round: number;
  keeper_year: number;
  owner_name: string;
  owner_id: string;
}

export default function KeepersPage() {
  const { owner, isAdmin, adminMode, loading: authLoading } = useAuth();
  const [season, setSeason] = useState(2026);
  const [data, setData] = useState<OwnerKeepers[]>([]);
  const [historicalKeepers, setHistoricalKeepers] = useState<HistoricalKeeper[]>([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Map<string, Set<number>>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([2026, 2025]);

  const isCurrentSeason = season === 2026;

  // Filter: show all teams in admin mode, only your team otherwise
  const canEditAll = isAdmin && adminMode;
  const visibleData = canEditAll
    ? data
    : owner
    ? data.filter((d) => d.owner_id === owner.id)
    : [];

  const canEdit = (ownerId: string) =>
    isCurrentSeason && (canEditAll || (owner?.id === ownerId));

  // Load available years on mount
  useEffect(() => {
    async function loadYears() {
      try {
        const resp = await fetch("/api/keepers/years");
        const years = await resp.json();
        if (Array.isArray(years) && years.length > 0) {
          setAvailableYears([2026, ...years]);
        }
      } catch {}
    }
    loadYears();
  }, []);

  // Load keepers for selected season
  const loadKeepers = useCallback(async () => {
    setLoading(true);
    setHistoricalKeepers([]);
    setData([]);

    try {
      if (isCurrentSeason) {
        // Current season: load eligible keepers for election
        const resp = await fetch(`/api/keepers/eligible?season=${season}`);
        const result = await resp.json();
        setData(result);

        const newSelections = new Map<string, Set<number>>();
        for (const o of result) {
          newSelections.set(o.owner_id, new Set());
        }
        setSelections(newSelections);
      } else {
        // Historical: load keepers from draft_picks where is_keeper = true
        const resp = await fetch(`/api/keepers/history?year=${season}`);
        const result = await resp.json();
        setHistoricalKeepers(result);
      }
    } catch (err) {
      console.error("Failed to load keepers:", err);
    }
    setLoading(false);
  }, [season, isCurrentSeason]);

  useEffect(() => {
    loadKeepers();
  }, [loadKeepers]);

  const toggleKeeper = (ownerId: string, playerId: number) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const ownerSet = new Set(next.get(ownerId) ?? []);
      if (ownerSet.has(playerId)) {
        ownerSet.delete(playerId);
      } else if (ownerSet.size < 5) {
        ownerSet.add(playerId);
      }
      next.set(ownerId, ownerSet);
      return next;
    });
  };

  const saveKeepers = async (ownerId: string) => {
    const ownerData = data.find((d) => d.owner_id === ownerId);
    if (!ownerData) return;

    const selected = selections.get(ownerId) ?? new Set();
    const keeperPayload = ownerData.players
      .filter((p) => selected.has(p.player_id))
      .map((p) => ({
        player_id: p.player_id,
        keeper_year: p.keeper_year,
        round_cost: p.round_cost,
        source_type: p.source,
      }));

    setSaving(ownerId);
    try {
      const resp = await fetch("/api/keepers/elect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_year: season,
          owner_id: ownerId,
          keepers: keeperPayload,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        setSavedMessage(`${ownerData.owner_name}: ${keeperPayload.length} keepers saved`);
        setTimeout(() => setSavedMessage(null), 3000);
      } else {
        setSavedMessage(`Error: ${result.error}`);
      }
    } catch (err) {
      setSavedMessage("Failed to save");
    }
    setSaving(null);
  };

  if (loading || authLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Keeper Management</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 h-48 shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (!owner) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Keeper Management</h1>
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-muted mb-4">Sign in to manage your keepers</p>
          <a href="/login" className="btn-primary px-6 py-2 inline-block">Sign In</a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Keeper Management</h1>
          <p className="text-muted text-sm">
            {isCurrentSeason
              ? `Select up to 5 keepers per team for the ${season} season.`
              : `Viewing keepers used in the ${season} draft.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedMessage && (
            <span className="text-xs text-accent font-medium fade-in">
              {savedMessage}
            </span>
          )}
          <select
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value))}
            className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y} {y === 2026 ? "(Upcoming)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Keeper rules + legend */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-6 text-xs text-muted flex-wrap">
          <span>Max <span className="text-foreground font-bold">5</span> keepers</span>
          <span>Cost escalates +1 round/year</span>
          <span>Round 1 always costs Round 1</span>
          <span>Free agents = Round 10</span>
          <span>Post-deadline FA pickups ineligible</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted font-semibold">Urgency:</span>
          <KeeperBadge year={1} />
          <span className="text-[9px] text-muted">3yr left</span>
          <KeeperBadge year={2} />
          <span className="text-[9px] text-muted">2yr left</span>
          <KeeperBadge year={3} />
          <span className="text-[9px] text-warning">1yr left</span>
          <KeeperBadge year={4} />
          <span className="text-[9px] text-danger">Last year</span>
        </div>
      </div>

      {/* Historical keeper view for past seasons */}
      {!isCurrentSeason && historicalKeepers.length > 0 && (
        <HistoricalKeepersView keepers={historicalKeepers} />
      )}

      {!isCurrentSeason && historicalKeepers.length === 0 && !loading && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted text-sm">
          No keeper data found for {season}
        </div>
      )}

      {/* Current season election UI */}
      {isCurrentSeason && (
        <>
      {/* View mode indicator */}
      {!canEditAll && owner && (
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-accent font-semibold">
            Viewing: {owner.name} — {owner.team_name}
          </span>
          {isAdmin && (
            <span className="text-[10px] text-muted">
              Toggle Admin mode in the nav to edit all teams
            </span>
          )}
        </div>
      )}

      {canEditAll && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-3">
          <span className="text-xs text-warning font-semibold">
            Admin Mode — Editing all {visibleData.length} teams
          </span>
        </div>
      )}

      {/* Owner cards */}
      <div className={`grid grid-cols-1 ${canEditAll ? "lg:grid-cols-2" : "lg:grid-cols-1 max-w-2xl"} gap-4`}>
        {visibleData.map((ownerData) => {
          const selected = selections.get(ownerData.owner_id) ?? new Set();
          const eligible = ownerData.players.filter((p) => p.eligible);
          const ineligible = ownerData.players.filter((p) => !p.eligible);
          const editable = canEdit(ownerData.owner_id);

          return (
            <div
              key={ownerData.owner_id}
              className={`bg-card border rounded-xl overflow-hidden ${
                editable ? "border-border" : "border-border/50"
              }`}
            >
              {/* Owner header */}
              <div className="px-4 py-3 border-b border-border bg-card-elevated/30 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">{ownerData.owner_name}</h3>
                  <p className="text-[10px] text-muted">
                    {ownerData.team_name} — {ownerData.players.length} players
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">
                    <span className={`font-bold ${selected.size >= 5 ? "text-danger" : "text-accent"}`}>
                      {selected.size}
                    </span>
                    /5 keepers
                  </span>
                  {editable && (
                    <button
                      onClick={() => saveKeepers(ownerData.owner_id)}
                      disabled={saving === ownerData.owner_id}
                      className={`btn-primary text-[10px] px-3 py-1 ${
                        saving === ownerData.owner_id ? "opacity-50" : ""
                      }`}
                    >
                      {saving === ownerData.owner_id ? "Saving..." : "Save"}
                    </button>
                  )}
                </div>
              </div>

              {/* Eligible players */}
              <div className="divide-y divide-border/20">
                {eligible.length === 0 && (
                  <div className="p-4 text-center text-muted text-xs">
                    No keeper-eligible players found
                  </div>
                )}
                {eligible.map((player) => {
                  const isSelected = selected.has(player.player_id);
                  const canSelect = isSelected || selected.size < 5;

                  return (
                    <div
                      key={player.player_id}
                      className={`flex items-center gap-3 px-4 py-2 transition-colors ${
                        !editable
                          ? ""
                          : isSelected
                          ? "bg-accent/10 cursor-pointer"
                          : canSelect
                          ? "hover:bg-card-hover/50 cursor-pointer"
                          : "opacity-40"
                      }`}
                      onClick={() => editable && canSelect && toggleKeeper(ownerData.owner_id, player.player_id)}
                    >
                      {/* Checkbox — only shown when editable */}
                      {editable ? (
                        <div
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected
                              ? "bg-accent border-accent"
                              : "border-border"
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-2.5 h-2.5 text-background" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      ) : (
                        <div className="w-4" />
                      )}

                      {/* Position badge */}
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${
                          POS_BADGE[player.position] ?? ""
                        }`}
                      >
                        {player.position}
                      </span>

                      {/* Player info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">
                          {player.player_name}
                        </div>
                        <div className="text-[10px] text-muted">
                          {player.nfl_team ?? "FA"}
                          {player.source === "free_agent" && " · Free Agent"}
                        </div>
                      </div>

                      {/* Keeper info */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <KeeperBadge year={player.keeper_year} />
                        <div className="text-right">
                          <div className="text-xs font-bold">
                            Rd {player.round_cost}
                          </div>
                          <div className={`text-[9px] ${
                            player.years_remaining <= 1 ? "text-danger font-semibold" :
                            player.years_remaining <= 2 ? "text-warning" : "text-muted"
                          }`}>
                            {player.years_remaining === 0
                              ? "Last year"
                              : `${player.years_remaining}yr left`}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Ineligible players — always visible with red strikethrough */}
                {ineligible.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 bg-danger/5 border-t border-danger/20">
                      <span className="text-[10px] font-bold text-danger uppercase tracking-wider">
                        Ineligible ({ineligible.length})
                      </span>
                    </div>
                    {ineligible.map((player) => (
                      <div
                        key={player.player_id}
                        className="flex items-center gap-3 px-4 py-2 bg-danger/5 border-b border-danger/10"
                      >
                        {/* Red X */}
                        <div className="w-4 h-4 rounded border-2 border-danger/40 flex items-center justify-center flex-shrink-0">
                          <svg className="w-2.5 h-2.5 text-danger" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </div>

                        <span
                          className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 opacity-50 ${
                            POS_BADGE[player.position] ?? ""
                          }`}
                        >
                          {player.position}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted line-through truncate">
                            {player.player_name}
                          </div>
                          <div className="text-[10px] text-muted/50">
                            {player.nfl_team ?? "FA"}
                          </div>
                        </div>

                        <span className="text-[9px] font-semibold text-danger bg-danger/10 px-2 py-0.5 rounded">
                          {player.reason ?? "Not eligible"}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}

function HistoricalKeepersView({ keepers }: { keepers: HistoricalKeeper[] }) {
  // Group by owner
  const byOwner = new Map<string, HistoricalKeeper[]>();
  for (const k of keepers) {
    if (!byOwner.has(k.owner_id)) byOwner.set(k.owner_id, []);
    byOwner.get(k.owner_id)!.push(k);
  }

  const POS_BADGE: Record<string, string> = {
    QB: "pos-qb", RB: "pos-rb", WR: "pos-wr", TE: "pos-te", DEF: "pos-def", K: "pos-def",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from(byOwner.entries())
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([ownerId, ownerKeepers]) => (
          <div
            key={ownerId}
            className="bg-card border border-border rounded-xl overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-border bg-card-elevated/30 flex items-center justify-between">
              <a href={`/owners/${ownerId}`} className="font-bold text-sm hover:text-accent">
                {ownerKeepers[0].owner_name}
              </a>
              <span className="text-[10px] text-muted">
                {ownerKeepers.length} keeper{ownerKeepers.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="divide-y divide-border/20">
              {ownerKeepers
                .sort((a, b) => a.round - b.round)
                .map((k, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2">
                    <span
                      className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${
                        POS_BADGE[k.position] ?? ""
                      }`}
                    >
                      {k.position}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate">
                        {k.player_name}
                      </div>
                    </div>
                    <KeeperBadge year={k.keeper_year} />
                    <div className="text-xs font-bold text-muted">
                      Rd {k.round}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}
