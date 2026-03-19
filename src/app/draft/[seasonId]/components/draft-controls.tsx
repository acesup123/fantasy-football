"use client";

import { useState, useEffect, useRef } from "react";
import type { DraftPick, Owner } from "@/types/database";

interface DraftControlsProps {
  currentPick: DraftPick | null;
  isMyTurn: boolean;
  ownerMap: Map<string, Owner>;
  timerSeconds: number;
  onNextPick?: DraftPick | null;
}

export function DraftControls({
  currentPick,
  isMyTurn,
  ownerMap,
  timerSeconds,
  onNextPick,
}: DraftControlsProps) {
  const [timeLeft, setTimeLeft] = useState(timerSeconds);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset timer when pick changes
  useEffect(() => {
    setTimeLeft(timerSeconds);
  }, [currentPick?.overall_pick, timerSeconds]);

  // Countdown
  useEffect(() => {
    if (isPaused || !currentPick) return;

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
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

          {/* Controls */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            {isMyTurn && (
              <button className="btn-primary text-xs px-3 py-1.5">
                Auto Pick
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
