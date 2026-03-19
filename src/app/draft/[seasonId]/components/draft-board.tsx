"use client";

import { useMemo } from "react";
import type { DraftPick, Owner, Player } from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";
import { formatPickLabel } from "@/lib/draft/snake-order";

interface DraftBoardProps {
  picks: DraftPick[];
  owners: Owner[];
  playerMap: Map<number, Player>;
  currentPickNumber: number;
  recentPickId?: number; // ID of the most recently made pick (for animation)
}

const POS_CELL_CLASS: Record<string, string> = {
  QB: "pick-cell-qb",
  RB: "pick-cell-rb",
  WR: "pick-cell-wr",
  TE: "pick-cell-te",
  DEF: "pick-cell-def",
};

const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  DEF: "text-def",
};

export function DraftBoard({
  picks,
  owners,
  playerMap,
  currentPickNumber,
  recentPickId,
}: DraftBoardProps) {
  const grid = useMemo(() => {
    const g: (DraftPick | null)[][] = Array.from(
      { length: LEAGUE_CONFIG.NUM_ROUNDS },
      () => Array(LEAGUE_CONFIG.NUM_TEAMS).fill(null)
    );
    for (const pick of picks) {
      g[pick.round - 1][pick.pick_in_round - 1] = pick;
    }
    return g;
  }, [picks]);

  const ownerMap = useMemo(
    () => new Map(owners.map((o) => [o.id, o])),
    [owners]
  );

  // Count picks per owner (for column header progress)
  const pickCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pick of picks) {
      if (pick.player_id !== null) {
        const id = pick.current_owner_id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [picks]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
      {/* Board header */}
      <div className="px-4 py-2.5 border-b border-border bg-card-elevated/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-widest text-accent">
            Live Draft Board
          </span>
        </div>
        <span className="text-xs text-muted font-mono">
          {picks.filter((p) => p.player_id !== null).length} / {LEAGUE_CONFIG.NUM_TEAMS * LEAGUE_CONFIG.NUM_ROUNDS} picks
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-3 text-left text-[10px] text-muted font-semibold uppercase tracking-wider w-10 bg-card-elevated/30">
                Rd
              </th>
              {Array.from({ length: LEAGUE_CONFIG.NUM_TEAMS }, (_, i) => {
                const round1Pick = picks.find(
                  (p) => p.round === 1 && p.pick_in_round === i + 1
                );
                const owner = round1Pick
                  ? ownerMap.get(round1Pick.original_owner_id)
                  : null;
                const count = owner ? (pickCounts.get(owner.id) ?? 0) : 0;
                const isCurrent = round1Pick?.original_owner_id ===
                  picks.find((p) => p.overall_pick === currentPickNumber)?.current_owner_id;

                return (
                  <th
                    key={i}
                    className={`px-1 py-2 text-center transition-colors ${
                      isCurrent ? "bg-accent/5" : ""
                    }`}
                  >
                    <div className="text-xs font-bold truncate max-w-[90px]">
                      {owner?.team_name ?? `Pick ${i + 1}`}
                    </div>
                    <div className="text-[9px] text-muted mt-0.5">
                      {count}/{LEAGUE_CONFIG.NUM_ROUNDS}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, roundIdx) => (
              <tr key={roundIdx} className="border-b border-border/30">
                <td className="px-2 py-1 text-center bg-card-elevated/30">
                  <span className="text-[11px] text-muted/70 font-bold">
                    {roundIdx + 1}
                  </span>
                </td>
                {row.map((pick, colIdx) => (
                  <td key={colIdx} className="px-0.5 py-0.5">
                    <PickCell
                      pick={pick}
                      playerMap={playerMap}
                      ownerMap={ownerMap}
                      isCurrentPick={pick?.overall_pick === currentPickNumber}
                      isRecentPick={pick?.id === recentPickId}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PickCell({
  pick,
  playerMap,
  ownerMap,
  isCurrentPick,
  isRecentPick,
}: {
  pick: DraftPick | null;
  playerMap: Map<number, Player>;
  ownerMap: Map<string, Owner>;
  isCurrentPick: boolean;
  isRecentPick: boolean;
}) {
  if (!pick) {
    return <div className="h-14 rounded-md bg-background/20" />;
  }

  const player = pick.player_id ? playerMap.get(pick.player_id) : null;
  const isTraded = pick.current_owner_id !== pick.original_owner_id;
  const tradedFrom = isTraded ? ownerMap.get(pick.original_owner_id) : null;

  // Empty pick
  if (!player) {
    return (
      <div
        className={`pick-cell h-14 border flex items-center justify-center ${
          isCurrentPick
            ? "current-pick border-accent/60 bg-accent/8"
            : "border-transparent bg-background/15 hover:bg-background/25"
        }`}
      >
        <div className="text-center">
          <div className="text-muted/50 font-mono text-[10px] font-semibold">
            {formatPickLabel(pick.round, pick.pick_in_round)}
          </div>
          {isTraded && tradedFrom && (
            <div className="text-traded text-[8px] font-semibold mt-0.5">
              via {tradedFrom.team_name}
            </div>
          )}
          {isCurrentPick && (
            <div className="text-accent text-[8px] font-bold uppercase mt-0.5 tracking-wider">
              Now
            </div>
          )}
        </div>
      </div>
    );
  }

  // Filled pick
  const posClass = POS_CELL_CLASS[player.position] ?? "";
  const posText = POS_TEXT[player.position] ?? "text-foreground";

  return (
    <div
      className={`pick-cell pick-cell-filled h-14 px-1.5 py-1 flex flex-col justify-center ${posClass} ${
        pick.is_keeper ? "pick-cell-keeper" : ""
      } ${isRecentPick ? "pick-just-made" : ""} ${
        isCurrentPick ? "current-pick" : ""
      }`}
    >
      {/* Player name + position */}
      <div className="flex items-center gap-1 min-w-0">
        <span
          className={`text-[9px] font-black px-1 py-px rounded ${posText} bg-current/10 flex-shrink-0`}
        >
          {player.position}
        </span>
        <span className="text-[11px] font-semibold truncate leading-tight">
          {player.name}
        </span>
      </div>

      {/* Second row: team + badges */}
      <div className="flex items-center gap-1 mt-0.5 min-w-0">
        {player.nfl_team && (
          <span className="text-[9px] text-muted font-medium">{player.nfl_team}</span>
        )}
        {pick.is_keeper && pick.keeper_year && (
          <span className="keeper-badge">K{pick.keeper_year}</span>
        )}
        {isTraded && tradedFrom && (
          <span className="text-[8px] text-traded/80 font-medium truncate">
            via {tradedFrom.team_name}
          </span>
        )}
        {pick.is_auto_pick && (
          <span className="text-[8px] text-muted/50 italic">auto</span>
        )}
      </div>
    </div>
  );
}
