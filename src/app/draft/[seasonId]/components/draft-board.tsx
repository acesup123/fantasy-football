"use client";

import { useMemo } from "react";
import type { DraftPick, Owner, Player } from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";
import { formatPickLabel } from "@/lib/draft/snake-order";
import { abbreviateName } from "@/lib/draft/roster-requirements";
import { espnProfileUrl } from "@/lib/espn/profile-url";
import { RosterGrid } from "./roster-grid";

interface DraftBoardProps {
  picks: DraftPick[];
  owners: Owner[];
  playerMap: Map<number, Player>;
  currentPickNumber: number;
  recentPickId?: number; // ID of the most recently made pick (for animation)
  currentOwnerId?: string;
  /** Controlled by the page — the rosters view takes the full width. */
  view: BoardView;
  onViewChange: (view: BoardView) => void;
}

export type BoardView = "board" | "rosters";

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
  currentOwnerId,
  view,
  onViewChange,
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
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg min-w-0">
      {/* Board header */}
      <div className="px-3 py-2 border-b border-border bg-card-elevated/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
          <span className="text-xs font-bold uppercase tracking-widest text-accent truncate">
            {view === "board" ? "Live Draft Board" : "Rosters by Position"}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-muted font-mono hidden sm:inline">
            {picks.filter((p) => p.player_id !== null).length} / {LEAGUE_CONFIG.NUM_TEAMS * LEAGUE_CONFIG.NUM_ROUNDS} picks
          </span>

          {/* View toggle */}
          <div className="flex rounded-md bg-background/60 p-0.5">
            {(["board", "rosters"] as const).map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-all ${
                  view === v
                    ? "bg-accent text-background"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {v === "board" ? "Board" : "Rosters"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "rosters" ? (
        <div className="p-2">
          <RosterGrid
            picks={picks}
            owners={owners}
            playerMap={playerMap}
            currentOwnerId={currentOwnerId}
          />
        </div>
      ) : (
      // All 12 teams share the width — no horizontal scroll, scroll the page
      // vertically through the 15 rounds instead. On a phone 12 columns works
      // out to ~28px each, which is illegible, so below sm the board keeps a
      // readable minimum and scrolls sideways within its own box.
      <div className="overflow-x-auto sm:overflow-x-visible">
        <table className="w-full table-fixed max-sm:min-w-[680px]">
          <colgroup>
            <col className="w-7" />
            {Array.from({ length: LEAGUE_CONFIG.NUM_TEAMS }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="px-1 py-2 text-left text-[9px] text-muted font-semibold uppercase tracking-wider bg-card-elevated/30">
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
                    className={`px-0.5 py-1.5 text-center transition-colors ${
                      isCurrent ? "bg-accent/5" : ""
                    }`}
                    title={owner?.team_name ?? undefined}
                  >
                    <div className="text-[10px] font-bold truncate leading-tight">
                      {owner?.team_name ?? `Pick ${i + 1}`}
                    </div>
                    <div className="text-[9px] text-muted">
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
                <td className="px-1 py-1 text-center bg-card-elevated/30">
                  <span className="text-[10px] text-muted/70 font-bold">
                    {roundIdx + 1}
                  </span>
                </td>
                {row.map((pick, colIdx) => (
                  <td key={colIdx} className="px-px py-px">
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
      )}
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
    return <div className="h-11 rounded-md bg-background/20" />;
  }

  const player = pick.player_id ? playerMap.get(pick.player_id) : null;
  const isTraded = pick.current_owner_id !== pick.original_owner_id;
  const tradedFrom = isTraded ? ownerMap.get(pick.original_owner_id) : null;

  // Empty pick
  if (!player) {
    return (
      <div
        className={`pick-cell h-11 border flex items-center justify-center overflow-hidden ${
          isCurrentPick
            ? "current-pick border-accent/60 bg-accent/8"
            : "border-transparent bg-background/15 hover:bg-background/25"
        }`}
        title={isTraded && tradedFrom ? `via ${tradedFrom.team_name}` : undefined}
      >
        <div className="text-center min-w-0 px-0.5">
          <div className="text-muted/50 font-mono text-[9px] font-semibold">
            {formatPickLabel(pick.round, pick.pick_in_round)}
          </div>
          {isTraded && tradedFrom && (
            <div className="text-traded text-[8px] font-semibold truncate">
              via {tradedFrom.team_name}
            </div>
          )}
          {isCurrentPick && (
            <div className="text-accent text-[8px] font-bold uppercase tracking-wider">
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
  const espnUrl = espnProfileUrl(player);

  return (
    <div
      className={`pick-cell pick-cell-filled h-11 px-1 py-0.5 flex flex-col justify-center overflow-hidden ${posClass} ${
        pick.is_keeper ? "pick-cell-keeper" : ""
      } ${isRecentPick ? "pick-just-made" : ""} ${
        isCurrentPick ? "current-pick" : ""
      }`}
      title={`${player.name}${player.nfl_team ? ` · ${player.nfl_team}` : ""}${
        isTraded && tradedFrom ? ` · via ${tradedFrom.team_name}` : ""
      }`}
    >
      {/* Player name — abbreviated so it survives a 1/12-width column */}
      <div className="text-[10px] font-semibold truncate leading-tight">
        {espnUrl ? (
          <a
            href={espnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-accent"
          >
            {abbreviateName(player.name)}
          </a>
        ) : (
          abbreviateName(player.name)
        )}
      </div>

      {/* Second row: position, team, badges */}
      <div className="flex items-center gap-0.5 min-w-0">
        <span className={`text-[8px] font-black ${posText} flex-shrink-0`}>
          {player.position}
        </span>
        {player.nfl_team && (
          <span className="text-[8px] text-muted font-medium truncate">
            {player.nfl_team}
          </span>
        )}
        {pick.is_keeper && pick.keeper_year && (
          <span className="keeper-badge flex-shrink-0">K{pick.keeper_year}</span>
        )}
        {isTraded && tradedFrom && (
          <span className="text-[8px] text-traded/80 font-bold flex-shrink-0">↔</span>
        )}
        {pick.is_auto_pick && (
          <span className="text-[8px] text-muted/50 italic flex-shrink-0">a</span>
        )}
      </div>
    </div>
  );
}
