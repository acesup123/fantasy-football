"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { DraftPick, Owner } from "@/types/database";

interface DraftControlsProps {
  currentPick: DraftPick | null;
  isMyTurn: boolean;
  ownerMap: Map<string, Owner>;
  timerSeconds: number;
  onNextPick?: DraftPick | null;
  /** Season the clock belongs to. Omit to fall back to a local countdown. */
  seasonId?: number;
  /** Only the commissioner may pause or resume. */
  canControlClock?: boolean;
}

export function DraftControls({
  currentPick,
  isMyTurn,
  ownerMap,
  timerSeconds,
  onNextPick,
  seasonId,
  canControlClock = false,
}: DraftControlsProps) {
  const [timeLeft, setTimeLeft] = useState(timerSeconds);
  const [isPaused, setIsPaused] = useState(false);
  const [clockSynced, setClockSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Server deadline in *local* epoch ms, corrected for this machine's clock skew.
  const deadlineRef = useRef<number | null>(null);

  /**
   * Pull the shared clock. The server returns its own timestamp, so a client
   * whose system clock is off still counts down to the same moment.
   */
  const syncClock = useCallback(async () => {
    if (!seasonId) return;
    try {
      const resp = await fetch(`/api/draft/clock?season_id=${seasonId}`, { cache: "no-store" });
      if (!resp.ok) return;
      const c = await resp.json();
      const skew = Date.now() - c.serverNow;
      deadlineRef.current = c.deadline === null ? null : c.deadline + skew;
      setIsPaused(Boolean(c.paused));
      setTimeLeft(Math.round(c.remainingMs / 1000));
      setClockSynced(true);
    } catch {
      // Leave the last known state; the local tick keeps running.
    }
  }, [seasonId]);

  // Re-sync on mount, when the pick changes, and every few seconds so a pause
  // by the commissioner reaches everyone quickly.
  useEffect(() => {
    if (!seasonId) return;
    syncClock();
    const id = setInterval(syncClock, 3000);
    return () => clearInterval(id);
  }, [seasonId, syncClock, currentPick?.overall_pick]);

  const setClock = async (action: "pause" | "resume" | "reset") => {
    if (!seasonId || !canControlClock) return;
    setBusy(true);
    try {
      await fetch("/api/draft/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season_id: seasonId, action }),
      });
      await syncClock();
    } catch {
      // Ignore — the next poll will reconcile.
    }
    setBusy(false);
  };

  // Reset timer when pick changes (local fallback only)
  useEffect(() => {
    if (clockSynced) return;
    setTimeLeft(timerSeconds);
  }, [currentPick?.overall_pick, timerSeconds, clockSynced]);

  // Countdown.
  //
  // Advisory only: this runs per browser, starts when that browser saw the
  // pick change, and nothing happens at zero — there is no server deadline and
  // no auto-pick. Two people watching will see different numbers. It is a
  // pacing aid, not an enforced clock.
  useEffect(() => {
    if (isPaused || !currentPick) return;

    intervalRef.current = setInterval(() => {
      // Once synced, count down to the server's deadline rather than
      // decrementing locally — that way a slow tab can't drift.
      if (deadlineRef.current !== null) {
        setTimeLeft(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
        return;
      }
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPaused, currentPick]);

  if (!currentPick) {
    return (
      <div className="draft-controls-bar rounded-xl p-6 text-center">
        <div className="text-2xl font-bold text-muted">Waiting for Draft to Begin</div>
        <div className="text-sm text-muted mt-1">The commissioner will start the draft when all owners are ready</div>
      </div>
    );
  }

  const currentOwner = ownerMap.get(currentPick.current_owner_id);
  const nextOwner = onNextPick ? ownerMap.get(onNextPick.current_owner_id) : null;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const progress = timeLeft / timerSeconds;
  const isLow = timeLeft <= 30 && timeLeft > 10;
  const isCritical = timeLeft <= 10;
  const isExpired = timeLeft <= 0;

  // SVG circular timer values
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className={`draft-controls-bar rounded-xl p-4 ${isMyTurn ? "your-turn" : ""}`}>
      <div className="flex items-center justify-between gap-6">
        {/* Left: On the Clock info */}
        <div className="flex items-center gap-5 min-w-0">
          {/* Circular timer */}
          <div className="relative flex-shrink-0">
            <svg width="100" height="100" viewBox="0 0 100 100">
              {/* Background ring */}
              <circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke="var(--border)"
                strokeWidth="6"
              />
              {/* Progress ring */}
              <circle
                cx="50" cy="50" r={radius}
                fill="none"
                stroke={
                  isExpired ? "var(--danger)"
                  : isCritical ? "var(--danger)"
                  : isLow ? "var(--warning)"
                  : "var(--accent)"
                }
                strokeWidth="6"
                className="timer-ring"
                style={{
                  strokeDashoffset: dashOffset,
                  strokeDasharray: circumference,
                }}
              />
            </svg>
            {/* Timer text centered in circle */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className={`font-mono text-xl font-black tabular-nums leading-none ${
                  isExpired ? "text-danger"
                  : isCritical ? "text-danger timer-critical"
                  : isLow ? "text-warning timer-urgent"
                  : "text-foreground"
                }`}
              >
                {minutes}:{String(seconds).padStart(2, "0")}
              </span>
              {isPaused && (
                <span className="text-[9px] text-warning font-bold uppercase mt-0.5">
                  Paused
                </span>
              )}
            </div>
          </div>

          {/* Pick info */}
          <div className="min-w-0">
            <div className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-0.5">
              On the Clock
            </div>
            <div className={`text-2xl font-black tracking-tight leading-tight ${isMyTurn ? "text-accent" : "text-foreground"}`}>
              {isMyTurn ? "YOUR PICK" : currentOwner?.team_name ?? "Unknown"}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-muted">
                Round {currentPick.round}
                <span className="text-foreground/40 mx-1">|</span>
                Pick {currentPick.pick_in_round}
              </span>
              <span className="font-mono text-xs text-muted/60 bg-background/40 px-2 py-0.5 rounded">
                #{currentPick.overall_pick} overall
              </span>
            </div>
          </div>
        </div>

        {/* Right: Up next + controls */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Up next */}
          {nextOwner && (
            <div className="text-right hidden md:block">
              <div className="text-[10px] text-muted uppercase tracking-wide">Up Next</div>
              <div className="text-sm font-semibold text-foreground/70">
                {nextOwner.team_name}
              </div>
            </div>
          )}

          {/* Controls — the clock is shared, so only the commissioner moves it */}
          <div className="flex flex-col gap-1.5">
            {canControlClock ? (
              <button
                onClick={() => setClock(isPaused ? "resume" : "pause")}
                disabled={busy}
                className={`btn-secondary text-xs px-3 py-1.5 ${busy ? "opacity-50" : ""}`}
              >
                {busy ? "..." : isPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            ) : (
              isPaused && (
                <span className="text-xs font-bold text-warning px-3 py-1.5 bg-warning/10 rounded-lg">
                  ⏸ Paused
                </span>
              )
            )}
            {canControlClock && (
              <button
                onClick={() => setClock("reset")}
                disabled={busy}
                className="text-[10px] text-muted hover:text-accent"
              >
                reset clock
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
