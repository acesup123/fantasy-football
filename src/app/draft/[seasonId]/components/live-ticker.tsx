"use client";

import type { DraftPick, Owner, Player } from "@/types/database";

interface LiveTickerProps {
  picks: DraftPick[];
  ownerMap: Map<string, Owner>;
  playerMap: Map<number, Player>;
}

const POS_DOT: Record<string, string> = {
  QB: "bg-qb",
  RB: "bg-rb",
  WR: "bg-wr",
  TE: "bg-te",
  DEF: "bg-def",
};

export function LiveTicker({ picks, ownerMap, playerMap }: LiveTickerProps) {
  // Get the last 8 completed picks, most recent first
  const recentPicks = picks
    .filter((p) => p.player_id !== null)
    .sort((a, b) => b.overall_pick - a.overall_pick)
    .slice(0, 8);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-card-elevated/50 flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
          Recent Picks
        </span>
      </div>

      {/* Pick list */}
      <div className="divide-y divide-border/20">
        {recentPicks.length === 0 ? (
          <div className="p-4 text-center text-muted text-xs">
            No picks yet — draft is about to begin
          </div>
        ) : (
          recentPicks.map((pick, i) => {
            const player = pick.player_id ? playerMap.get(pick.player_id) : null;
            const owner = ownerMap.get(pick.current_owner_id);

            if (!player) return null;

            return (
              <div
                key={pick.id}
                className={`ticker-item px-3 py-2 flex items-center gap-3 ${
                  i === 0 ? "slide-in" : "fade-in"
                }`}
                style={{
                  borderLeftColor: `var(--${player.position.toLowerCase()})`,
                  animationDelay: `${i * 50}ms`,
                }}
              >
                {/* Pick number */}
                <div className="flex-shrink-0 w-8 text-center">
                  <span className="text-[10px] text-muted/60 font-mono font-bold">
                    #{pick.overall_pick}
                  </span>
                </div>

                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${POS_DOT[player.position] ?? "bg-muted"}`} />
                    <span className="text-xs font-semibold truncate">
                      {player.name}
                    </span>
                    <span className="text-[9px] text-muted font-medium flex-shrink-0">
                      {player.position}
                    </span>
                  </div>
                  <div className="text-[9px] text-muted/60 mt-0.5 truncate">
                    {owner?.team_name ?? "Unknown"}
                    {player.nfl_team && ` · ${player.nfl_team}`}
                    {pick.is_keeper && ` · K${pick.keeper_year}`}
                  </div>
                </div>

                {/* Round badge */}
                <div className="flex-shrink-0">
                  <span className="text-[9px] text-muted/50 font-mono">
                    R{pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
