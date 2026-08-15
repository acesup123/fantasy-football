"use client";

import { useMemo } from "react";
import type { DraftPick, Owner, Player } from "@/types/database";
import { ROSTER_MINIMUMS } from "@/types/database";
import {
  abbreviateName,
  buildOwnerRosters,
  POSITION_ORDER,
  type OwnerRoster,
} from "@/lib/draft/roster-requirements";

interface RosterGridProps {
  picks: DraftPick[];
  owners: Owner[];
  playerMap: Map<number, Player>;
  currentOwnerId?: string;
}

const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  DEF: "text-def",
};

const POS_ROW: Record<string, string> = {
  QB: "pick-cell-qb",
  RB: "pick-cell-rb",
  WR: "pick-cell-wr",
  TE: "pick-cell-te",
  DEF: "pick-cell-def",
};

/**
 * Teams side by side, each read down by position — QB, then RB, WR, TE, DEF.
 * The complement to the board: the board answers "when was he taken", this
 * answers "what does this team actually have".
 */
export function RosterGrid({
  picks,
  owners,
  playerMap,
  currentOwnerId,
}: RosterGridProps) {
  const rosters = useMemo(
    () => buildOwnerRosters(picks, playerMap),
    [picks, playerMap]
  );

  // Keep the board's left-to-right team order rather than alphabetical.
  const orderedOwners = useMemo(() => {
    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    const seen = new Set<string>();
    const ordered: Owner[] = [];
    for (const pick of picks) {
      if (pick.round !== 1) continue;
      const owner = ownerMap.get(pick.original_owner_id);
      if (owner && !seen.has(owner.id)) {
        seen.add(owner.id);
        ordered.push(owner);
      }
    }
    for (const owner of owners) {
      if (!seen.has(owner.id)) ordered.push(owner);
    }
    return ordered;
  }, [owners, picks]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12 gap-1.5">
      {orderedOwners.map((owner) => (
        <RosterColumn
          key={owner.id}
          owner={owner}
          roster={rosters.get(owner.id)}
          isMe={owner.id === currentOwnerId}
        />
      ))}
    </div>
  );
}

function RosterColumn({
  owner,
  roster,
  isMe,
}: {
  owner: Owner;
  roster: OwnerRoster | undefined;
  isMe: boolean;
}) {
  const needs = roster ? POSITION_ORDER.filter((p) => roster.requirements.deficits[p]) : [];
  const forced = roster ? roster.requirements.requiredNow.length > 0 : false;
  // Early on every team is "missing" most positions — the per-position counters
  // already say so. Only raise the banner once the slack gets thin.
  const slack = roster
    ? roster.requirements.slotsRemaining - roster.requirements.totalDeficit
    : Infinity;
  const showNeeds = needs.length > 0 && slack <= 2;

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isMe ? "border-accent/50 bg-accent/5" : "border-border bg-background/20"
      }`}
    >
      {/* Team header */}
      <div className="px-1.5 py-1 border-b border-border/60 bg-card-elevated/40">
        <div className="text-[10px] font-bold truncate leading-tight" title={owner.team_name}>
          {owner.team_name}
        </div>
        <div className="text-[9px] text-muted font-mono">{roster?.filled ?? 0} drafted</div>
      </div>

      {/* Outstanding minimums */}
      {showNeeds && (
        <div
          className={`px-1.5 py-1 flex flex-wrap items-baseline gap-x-1 gap-y-0 border-b border-border/40 ${
            forced ? "bg-danger/10" : "bg-warning/8"
          }`}
          title={
            forced
              ? "Every remaining pick is committed to these positions"
              : `${slack} pick${slack === 1 ? "" : "s"} of slack left`
          }
        >
          <span className={`text-[8px] font-bold uppercase tracking-wide ${forced ? "text-danger" : "text-warning"}`}>
            {forced ? "Must" : "Needs"}
          </span>
          {needs.map((pos) => (
            <span
              key={pos}
              className={`text-[8px] font-black ${forced ? "text-danger" : "text-warning"}`}
            >
              {roster!.requirements.deficits[pos]}
              {pos}
            </span>
          ))}
        </div>
      )}

      {/* Players by position */}
      <div className="divide-y divide-border/20">
        {POSITION_ORDER.map((position) => {
          const group = roster?.byPosition.find((g) => g.position === position);
          const players = group?.players ?? [];
          const min = ROSTER_MINIMUMS[position];
          const short = min - players.length;

          return (
            <div key={position} className="px-1 py-1">
              <div className="flex items-baseline justify-between px-0.5">
                <span className={`text-[8px] font-black uppercase tracking-wider ${POS_TEXT[position]}`}>
                  {position}
                </span>
                <span className="text-[8px] text-muted/60 font-mono">
                  {players.length}/{min}
                </span>
              </div>

              {players.map(({ player, pick }) => (
                <div
                  key={pick.id}
                  className={`px-1 py-0.5 rounded text-[10px] leading-tight truncate ${POS_ROW[position]}`}
                  title={`${player.name} · ${player.nfl_team ?? "FA"}`}
                >
                  <span className="font-semibold">{abbreviateName(player.name)}</span>
                  {pick.is_keeper && pick.keeper_year && (
                    <span className="keeper-badge ml-1">K{pick.keeper_year}</span>
                  )}
                </div>
              ))}

              {/* One placeholder row per still-required slot */}
              {short > 0 &&
                Array.from({ length: short }, (_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="px-1 py-0.5 rounded text-[10px] leading-tight text-muted/40 border border-dashed border-border/50"
                  >
                    required
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
