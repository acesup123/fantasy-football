"use client";

import { useState, useMemo } from "react";
import type { Player } from "@/types/database";

interface PlayerPoolProps {
  players: Player[];
  isMyTurn: boolean;
  onPick: (playerId: number) => void;
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

export function PlayerPool({ players, isMyTurn, onPick }: PlayerPoolProps) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    let result = players;

    if (posFilter !== "ALL") {
      result = result.filter((p) => p.position === posFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nfl_team?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [players, posFilter, search]);

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
          </h3>
          <span className="text-[10px] text-muted font-mono">
            {filtered.length} available
          </span>
        </div>

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
