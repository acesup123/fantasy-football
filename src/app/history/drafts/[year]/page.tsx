import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { LEAGUE_CONFIG } from "@/types/database";

const POS_CELL: Record<string, string> = {
  QB: "pick-cell-qb",
  RB: "pick-cell-rb",
  WR: "pick-cell-wr",
  TE: "pick-cell-te",
  DEF: "pick-cell-def",
  K: "pick-cell-def",
};

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb", RB: "pos-rb", WR: "pos-wr", TE: "pos-te", DEF: "pos-def", K: "pos-def",
};

export default async function DraftBoardPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearStr } = await params;
  const year = parseInt(yearStr);
  const supabase = await createClient();

  // Get season
  const { data: season } = await supabase
    .from("seasons")
    .select("id")
    .eq("year", year)
    .single();

  if (!season) return notFound();

  // Get all picks for this season with player and owner details
  const { data: picks } = await supabase
    .from("draft_picks")
    .select("round, pick_in_round, overall_pick, is_keeper, keeper_year, current_owner_id, original_owner_id, players(name, position, nfl_team), owners!draft_picks_current_owner_id_fkey(id, name)")
    .eq("season_id", season.id)
    .order("overall_pick");

  if (!picks || picks.length === 0) return notFound();

  // Determine number of teams from data
  const numTeams = Math.max(...picks.map((p) => p.pick_in_round));
  const numRounds = Math.max(...picks.map((p) => p.round));

  // Get column headers from round 1 picks
  const round1 = picks
    .filter((p) => p.round === 1)
    .sort((a, b) => a.pick_in_round - b.pick_in_round);

  // Build grid
  const grid: (typeof picks[0] | null)[][] = Array.from(
    { length: numRounds },
    () => Array(numTeams).fill(null)
  );
  for (const pick of picks) {
    if (pick.round <= numRounds && pick.pick_in_round <= numTeams) {
      grid[pick.round - 1][pick.pick_in_round - 1] = pick;
    }
  }

  // Stats
  const posCounts: Record<string, number> = {};
  const keeperCount = picks.filter((p) => p.is_keeper).length;
  for (const p of picks) {
    const pos = (p.players as any)?.position ?? "?";
    posCounts[pos] = (posCounts[pos] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <a href="/history/drafts" className="text-xs text-muted hover:text-accent">
          ← All Drafts
        </a>
        <h1 className="text-3xl font-black mt-2">{year} Draft</h1>
        <div className="flex gap-4 mt-1 text-xs text-muted">
          <span>{picks.length} picks</span>
          <span>{keeperCount} keepers</span>
          {Object.entries(posCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([pos, count]) => (
              <span key={pos}>
                {count} {pos}
              </span>
            ))}
        </div>
      </div>

      {/* Draft Board Grid */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-[10px] text-muted font-semibold uppercase tracking-wider w-10 bg-card-elevated/30">
                  Rd
                </th>
                {round1.map((p, i) => (
                  <th key={i} className="px-1 py-2 text-center">
                    <div className="text-[10px] font-bold truncate max-w-[90px]">
                      {(p.owners as any)?.name ?? `Pick ${i + 1}`}
                    </div>
                  </th>
                ))}
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
                  {row.map((pick, colIdx) => {
                    if (!pick) {
                      return (
                        <td key={colIdx} className="px-0.5 py-0.5">
                          <div className="h-14 rounded-md bg-background/10" />
                        </td>
                      );
                    }

                    const player = pick.players as any;
                    const pos = player?.position ?? "?";
                    const isTraded = pick.current_owner_id !== pick.original_owner_id;

                    return (
                      <td key={colIdx} className="px-0.5 py-0.5">
                        <div
                          className={`pick-cell pick-cell-filled h-14 px-1.5 py-1 flex flex-col justify-center ${
                            POS_CELL[pos] ?? ""
                          } ${pick.is_keeper ? "pick-cell-keeper" : ""}`}
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className={`text-[9px] font-black px-1 py-px rounded flex-shrink-0 ${
                                POS_BADGE[pos] ?? ""
                              }`}
                            >
                              {pos}
                            </span>
                            <span className="text-[11px] font-semibold truncate leading-tight">
                              {player?.name ?? "—"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 min-w-0">
                            {player?.nfl_team && (
                              <span className="text-[9px] text-muted">
                                {player.nfl_team}
                              </span>
                            )}
                            {pick.is_keeper && pick.keeper_year && (
                              <span className="keeper-badge">
                                K{pick.keeper_year}
                              </span>
                            )}
                            {isTraded && (
                              <span className="text-[8px] text-traded font-medium">
                                traded
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Round-by-round list view */}
      <details>
        <summary className="text-sm font-semibold text-muted cursor-pointer hover:text-foreground">
          List View
        </summary>
        <div className="mt-3 bg-card border border-border rounded-xl overflow-hidden max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-card">
              <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
                <th className="text-center px-3 py-2">#</th>
                <th className="text-center px-3 py-2">Rd</th>
                <th className="text-left px-3 py-2">Owner</th>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-center px-3 py-2">Pos</th>
                <th className="text-center px-3 py-2">Team</th>
                <th className="text-center px-3 py-2">Keeper</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p) => {
                const player = p.players as any;
                const ownerData = p.owners as any;
                return (
                  <tr key={p.overall_pick} className="border-b border-border/20 hover:bg-card-hover/30">
                    <td className="px-3 py-1.5 text-xs text-center font-mono text-muted">
                      {p.overall_pick}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-center font-bold">
                      {p.round}.{String(p.pick_in_round).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <a href={`/owners/${ownerData?.id}`} className="hover:text-accent">
                        {ownerData?.name ?? "—"}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-xs font-medium">
                      {player?.name ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${POS_BADGE[player?.position] ?? ""}`}>
                        {player?.position ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-center text-muted">
                      {player?.nfl_team ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {p.is_keeper && p.keeper_year ? (
                        <span className="keeper-badge">K{p.keeper_year}</span>
                      ) : (
                        <span className="text-muted text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
