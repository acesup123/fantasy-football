"use client";

import { useState, useEffect, useCallback } from "react";

interface DraftCompleteProps {
  seasonId: number;
  seasonYear: number;
  isCommissioner: boolean;
}

interface FinalizedState {
  finalized: boolean;
  finalized_at?: string;
  finalized_by?: string;
  teams?: number;
  players?: number;
}

/**
 * Post-draft panel: finalize the results, download the board, and get the
 * picks over to ESPN.
 *
 * ESPN has no write API for draft results, so "push to ESPN" is the LM Tools
 * offline-draft entry flow — the ESPN sheet lists every pick in entry order.
 */
export function DraftComplete({ seasonId, seasonYear, isCommissioner }: DraftCompleteProps) {
  const [state, setState] = useState<FinalizedState | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  // Finalize overwrites the season's roster snapshot, so ask twice.
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch(`/api/draft/finalize?season_id=${seasonId}`, {
        cache: "no-store",
      });
      if (resp.ok) setState(await resp.json());
    } catch {
      // Leave unknown — the buttons still work.
    }
  }, [seasonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const finalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      const resp = await fetch("/api/draft/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season_id: seasonId }),
      });
      const data = await resp.json();
      if (!resp.ok) setError(data.error ?? "Failed to finalize");
      else setState({ finalized: true, ...data });
    } catch {
      setError("Network error — try again");
    }
    setFinalizing(false);
    setArmed(false);
  };

  const exportHref = (format: "board" | "espn") =>
    `/api/draft/export?season_id=${seasonId}&format=${format}`;

  return (
    <div className="card p-5 border border-accent/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-black tracking-tight">
            🏁 {seasonYear} Draft Complete
          </h2>
          {state?.finalized ? (
            <p className="text-xs text-accent mt-1">
              Finalized{state.finalized_by ? ` by ${state.finalized_by}` : ""}
              {state.finalized_at
                ? ` on ${new Date(state.finalized_at).toLocaleString()}`
                : ""}
              {state.teams ? ` — ${state.teams} rosters locked in` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              {isCommissioner
                ? "Finalize to lock the results and snapshot every roster."
                : "Waiting on the commissioner to finalize the results."}
            </p>
          )}
          {error && <p className="text-xs text-danger mt-1">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={exportHref("board")} className="btn-secondary text-xs px-3 py-2">
            ⬇ Download Draft Board
          </a>
          <a href={exportHref("espn")} className="btn-secondary text-xs px-3 py-2">
            ⬇ ESPN Entry Sheet
          </a>
          {isCommissioner &&
            (armed ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={finalize}
                  disabled={finalizing}
                  className={`btn-primary text-xs px-3 py-2 ${finalizing ? "opacity-50" : ""}`}
                >
                  {finalizing
                    ? "Finalizing..."
                    : state?.finalized
                      ? "Yes, rebuild rosters"
                      : "Yes, finalize"}
                </button>
                <button
                  onClick={() => setArmed(false)}
                  disabled={finalizing}
                  className="text-[10px] text-muted hover:text-foreground px-1"
                >
                  cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setArmed(true)}
                className="btn-primary text-xs px-3 py-2"
                title={
                  state?.finalized
                    ? "Rebuild the roster snapshot from the board as it stands now"
                    : "Lock the results and snapshot every roster"
                }
              >
                {state?.finalized ? "Re-finalize" : "✓ Finalize Draft"}
              </button>
            ))}
        </div>
      </div>

      {/* How the picks get onto ESPN — there is no API for this. */}
      <details className="mt-3">
        <summary className="text-xs text-muted cursor-pointer hover:text-foreground">
          How to push results to ESPN
        </summary>
        <ol className="text-xs text-muted mt-2 ml-4 list-decimal space-y-1">
          <li>Download the ESPN Entry Sheet above — picks are listed in entry order.</li>
          <li>
            In ESPN: League &gt; LM Tools &gt; Draft Tools, with the draft type set to
            Offline Draft.
          </li>
          <li>
            Enter each pick from the sheet in order. Keeper rows are marked (K1–K4)
            and belong to the team shown, same as any pick.
          </li>
          <li>Submit the results — ESPN builds every roster from the entered picks.</li>
        </ol>
      </details>
    </div>
  );
}
