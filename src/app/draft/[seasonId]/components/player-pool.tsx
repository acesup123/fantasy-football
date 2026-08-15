"use client";

import { useState, useMemo } from "react";
import type { Player } from "@/types/database";

interface PlayerPoolProps {
  players: Player[];
  isMyTurn: boolean;
  onPick: (playerId: number) => void;
  /** espn_id → ESPN draft rank, lower is better. Empty until ranks load. */
  ranks?: Record<string, { rank: number; adp: number | null }>;
  /** Set when the commissioner is picking on another owner's behalf. */
  pickingFor?: string | null;
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "DEF"] as const;

const POS_BADGE_CLASS: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  DEF: "pos-def",
};

const POS_FILTER_ACTIVE: Record<string, string> = {
  ALL: "bg-accent text-background",
  QB: "bg-qb text-white",
  RB: "bg-rb text-white",
  WR: "bg-wr text-white",
  TE: "bg-te text-white",
  DEF: "bg-def text-white",
};

export function PlayerPool({ players, isMyTurn, onPick, ranks, pickingFor }: PlayerPoolProps) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [byeFilter, setByeFilter] = useState<string>("ALL");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const rankOf = (p: Player) =>
    (p.espn_id && ranks?.[p.espn_id]?.rank) || Number.MAX_SAFE_INTEGER;

  // Bye weeks present in the pool, so the filter only offers real options.
  const byeWeeks = useMemo(
    () =>
      Array.from(new Set(players.map((p) => p.bye_week).filter(Boolean) as number[]))
        .sort((a, b) => a - b),
    [players]
  );

  const filtered = useMemo(() => {
    let result = players;

    if (posFilter !== "ALL") {
      result = result.filter((p) => p.position === posFilter);
    }

    if (byeFilter !== "ALL") {
      result =
        byeFilter === "NONE"
          ? result.filter((p) => !p.bye_week)
          : result.filter((p) => String(p.bye_week) === byeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nfl_team?.toLowerCase().includes(q)
      );
    }

    // Best available first. Unranked players sort to the bottom alphabetically
    // rather than disappearing, so nobody is undraftable if ranks fail to load.
    return [...result].sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [players, posFilter, byeFilter, search, ranks]);

  const handlePick = (playerId: number) => {
    if (confirmingId === playerId) {
      onPick(playerId);
      setConfirmingId(null);
    } else {
      setConfirmingId(playerId);
      // Auto-clear confirmation after 3s
      setTimeout(() => setConfirmingId(null), 3000);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-[calc(100vh-340px)] min-h-[350px]">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-xs uppercase tracking-widest text-foreground/70">
            Player Pool
            <span className="ml-2 normal-case tracking-normal font-normal text-[10px] text-muted">
              {ranks && Object.keys(ranks).length > 0 ? "best available" : "A-Z (ranks unavailable)"}
            </span>
          </h3>
          <span className="text-[10px] text-muted font-mono">
            {filtered.length} available
          </span>
        </div>

        {pickingFor && (
          <div className="bg-warning/10 border border-warning/30 rounded-md px-2 py-1">
            <span className="text-[10px] font-bold text-warning">
              Commissioner — picking for {pickingFor}
            </span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search players or teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Bye week filter */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted uppercase tracking-wide">Bye</span>
          <select
            value={byeFilter}
            onChange={(e) => setByeFilter(e.target.value)}
            className="flex-1 px-2 py-1 bg-background border border-border rounded-md text-[10px] focus:outline-none focus:border-accent"
          >
            <option value="ALL">Any bye week</option>
            {byeWeeks.map((w) => (
              <option key={w} value={String(w)}>Week {w}</option>
            ))}
            <option value="NONE">No bye listed</option>
          </select>
          {byeFilter !== "ALL" && (
            <button
              onClick={() => setByeFilter("ALL")}
              className="text-[10px] text-muted hover:text-accent"
            >
              clear
            </button>
          )}
        </div>

        {/* Position filters */}
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                posFilter === pos
                  ? POS_FILTER_ACTIVE[pos]
                  : "bg-background/60 text-muted hover:text-foreground hover:bg-background"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Player list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted text-xs">
            {players.length === 0
              ? "No players loaded — import players in Admin"
              : "No matching players"}
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map((player) => (
              <div
                key={player.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-card-hover/50 transition-colors group"
              >
                {/* ESPN rank */}
                <span className="text-[10px] font-mono text-muted/60 w-7 text-right flex-shrink-0">
                  {rankOf(player) === Number.MAX_SAFE_INTEGER ? "—" : rankOf(player)}
                </span>

                {/* Position badge */}
                <span
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${
                    POS_BADGE_CLASS[player.position] ?? ""
                  }`}
                >
                  {player.position}
                </span>

                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">
                    {player.name}
                  </div>
                  <div className="text-[10px] text-muted">
                    {player.nfl_team ?? "FA"}
                    {player.bye_week ? ` · Bye ${player.bye_week}` : ""}
                  </div>
                </div>

                {/* Draft button */}
                {isMyTurn && (
                  <button
                    onClick={() => handlePick(player.id)}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                      confirmingId === player.id
                        ? "btn-primary py-1 px-2.5 text-[10px]"
                        : "opacity-0 group-hover:opacity-100 bg-accent/15 text-accent hover:bg-accent/25"
                    }`}
                  >
                    {confirmingId === player.id ? "Confirm" : "Draft"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
