"use client";

import { useCallback, useMemo, useState } from "react";
import { compareStandings } from "@/lib/espn/client";

export interface StandingsRow {
  ownerId: string | null;
  ownerName: string;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  playoffSeed: number | null;
  finalRank: number | null;
  streakLength: number | null;
  streakType: "WIN" | "LOSS" | "TIE" | null;
  gamesBack: number | null;
  divisionId: number | null;
  divisionName: string | null;
  divisionWins: number | null;
  divisionLosses: number | null;
  divisionTies: number | null;
}

function formatRecord(r: StandingsRow): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

function formatDivisionRecord(r: StandingsRow): string {
  if (r.divisionWins === null || r.divisionLosses === null) return "—";
  return r.divisionTies
    ? `${r.divisionWins}-${r.divisionLosses}-${r.divisionTies}`
    : `${r.divisionWins}-${r.divisionLosses}`;
}

/**
 * Group rows into divisions, each internally ordered by the shared comparator.
 * Returns null when the season has no division data — pre-2018 seasons were
 * seeded from draft spreadsheets and never had it, so the caller falls back to
 * a single table rather than inventing a "Division —" bucket.
 */
function groupByDivision(rows: StandingsRow[]): { name: string; rows: StandingsRow[] }[] | null {
  if (rows.some((r) => r.divisionId === null)) return null;

  const byId = new Map<number, StandingsRow[]>();
  for (const r of rows) {
    const list = byId.get(r.divisionId!) ?? [];
    list.push(r);
    byId.set(r.divisionId!, list);
  }
  if (byId.size < 2) return null;

  return [...byId.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, group]) => ({
      name: group[0]?.divisionName ?? `Division ${id}`,
      rows: [...group].sort(compareStandings),
    }));
}

function formatStreak(r: StandingsRow): string {
  if (!r.streakType || !r.streakLength) return "—";
  const letter = r.streakType === "WIN" ? "W" : r.streakType === "LOSS" ? "L" : "T";
  return `${letter}${r.streakLength}`;
}

export function StandingsTable({
  initial,
  year,
}: {
  initial: StandingsRow[];
  year: number;
}) {
  const [rows, setRows] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const divisions = useMemo(() => groupByDivision(rows), [rows]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const resp = await fetch(`/api/standings/live?year=${year}`);
      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error ?? "Refresh failed");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const live: StandingsRow[] = (data.standings ?? []).map((s: any) => ({
        ownerId: s.ownerId,
        ownerName: s.ownerName ?? "Unknown",
        teamName: s.teamName,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        playoffSeed: s.playoffSeed,
        finalRank: s.finalRank,
        streakLength: s.streakLength,
        streakType: s.streakType,
        gamesBack: s.gamesBack,
        divisionId: s.divisionId,
        divisionName: s.divisionName,
        divisionWins: s.divisionWins,
        divisionLosses: s.divisionLosses,
        divisionTies: s.divisionTies,
      }));

      live.sort(compareStandings);

      setRows(live);
      setLiveAt(data.fetchedAt ?? null);
    } catch {
      setError("Could not reach ESPN");
    } finally {
      setRefreshing(false);
    }
  }, [year]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-sm">League Standings</h2>
          <p className="text-[11px] text-muted mt-0.5">
            {liveAt
              ? `Live from ESPN — ${new Date(liveAt).toLocaleTimeString()}`
              : "From the nightly sync"}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-[11px] px-3 py-1.5 bg-background border border-border rounded hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh from ESPN"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {divisions ? (
        divisions.map((div) => (
          <div key={div.name}>
            <div className="px-4 py-2 bg-background/40 border-y border-border/40">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-accent">
                {div.name}
              </h3>
            </div>
            <StandingsRows rows={div.rows} showDivisionRecord />
          </div>
        ))
      ) : (
        <StandingsRows rows={rows} showDivisionRecord={false} />
      )}

      <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted/50">
        Top 6 seeds make the playoffs (highlighted). The # column is ESPN&apos;s
        overall seed, which uses head-to-head record with division winners taking
        priority — so it is not simply wins or points order. Div is the
        in-division record; ESPN does not track points within a division.
      </div>
    </div>
  );
}

function StandingsRows({
  rows,
  showDivisionRecord,
}: {
  rows: StandingsRow[];
  showDivisionRecord: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border/50">
            <th className="text-left px-4 py-2">#</th>
            <th className="text-left px-4 py-2">Owner</th>
            <th className="text-left px-4 py-2">Team</th>
            <th className="text-center px-3 py-2">Record</th>
            {showDivisionRecord && <th className="text-center px-3 py-2">Div</th>}
            <th className="text-right px-3 py-2">PF</th>
            <th className="text-right px-3 py-2">PA</th>
            <th className="text-center px-3 py-2">Streak</th>
            <th className="text-center px-3 py-2">GB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.ownerId ?? r.ownerName}
              className={`border-b border-border/20 ${
                r.playoffSeed !== null && r.playoffSeed <= 6 ? "bg-accent/[0.03]" : ""
              }`}
            >
              <td className="px-4 py-2 text-sm font-bold text-muted">
                {r.playoffSeed ?? i + 1}
              </td>
              <td className="px-4 py-2 text-sm font-semibold">{r.ownerName}</td>
              <td className="px-4 py-2 text-xs text-muted">{r.teamName ?? "—"}</td>
              <td className="px-3 py-2 text-sm text-center font-mono">{formatRecord(r)}</td>
              {showDivisionRecord && (
                <td className="px-3 py-2 text-xs text-center font-mono text-muted">
                  {formatDivisionRecord(r)}
                </td>
              )}
              <td className="px-3 py-2 text-xs text-right font-mono text-muted">
                {r.pointsFor.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-xs text-right font-mono text-muted">
                {r.pointsAgainst.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-xs text-center font-mono">
                <span
                  className={
                    r.streakType === "WIN"
                      ? "text-accent"
                      : r.streakType === "LOSS"
                      ? "text-muted/60"
                      : "text-muted"
                  }
                >
                  {formatStreak(r)}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-center text-muted">
                {r.gamesBack === null || r.gamesBack === 0 ? "—" : r.gamesBack}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
