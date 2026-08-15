"use client";

import { useCallback, useState } from "react";
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
}

function formatRecord(r: StandingsRow): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
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

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border/50">
              <th className="text-left px-4 py-2">#</th>
              <th className="text-left px-4 py-2">Owner</th>
              <th className="text-left px-4 py-2">Team</th>
              <th className="text-center px-3 py-2">Record</th>
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
                className={`border-b border-border/20 ${i < 6 ? "bg-accent/[0.03]" : ""}`}
              >
                <td className="px-4 py-2 text-sm font-bold text-muted">
                  {r.playoffSeed ?? i + 1}
                </td>
                <td className="px-4 py-2 text-sm font-semibold">{r.ownerName}</td>
                <td className="px-4 py-2 text-xs text-muted">{r.teamName ?? "—"}</td>
                <td className="px-3 py-2 text-sm text-center font-mono">
                  {formatRecord(r)}
                </td>
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
                  {r.gamesBack === null ? "—" : r.gamesBack === 0 ? "—" : r.gamesBack}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border/50 text-[10px] text-muted/50">
        Top 6 make the playoffs. Order uses ESPN&apos;s seeding, which accounts for
        divisions and head-to-head tiebreaks.
      </div>
    </div>
  );
}
