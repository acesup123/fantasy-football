"use client";

import { useEffect } from "react";
import type { DraftPick, Player } from "@/types/database";
import { formatPickLabel } from "@/lib/draft/snake-order";

interface PickSplashProps {
  pick: DraftPick;
  player: Player;
  teamName: string;
  /** A full round of value or more — earns the stamp. */
  isSteal: boolean;
  onDone: () => void;
}

const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  DEF: "text-def",
};

// Confetti in the position palette plus accent. Index math instead of
// Math.random so a re-render mid-animation doesn't reshuffle the pieces.
const CONFETTI_COLORS = ["--qb", "--rb", "--wr", "--te", "--def", "--accent"];
const CONFETTI_COUNT = 28;

export function PickSplash({ pick, player, teamName, isSteal, onDone }: PickSplashProps) {
  // Auto-dismiss; the CSS fade-out starts just before this fires so the
  // unmount lands on an already-invisible overlay.
  useEffect(() => {
    const t = setTimeout(onDone, 3400);
    return () => clearTimeout(t);
  }, [pick.id, pick.player_id, onDone]);

  const posText = POS_TEXT[player.position] ?? "text-foreground";

  return (
    <div
      className="pick-splash"
      onClick={onDone}
      role="status"
      aria-live="polite"
    >
      {/* Confetti burst */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${(i * 37 + 11) % 100}%`,
              width: `${6 + (i % 3) * 2}px`,
              height: `${10 + (i % 4) * 3}px`,
              background: `var(${CONFETTI_COLORS[i % CONFETTI_COLORS.length]})`,
              animationDelay: `${(i % 7) * 110}ms`,
              animationDuration: `${2100 + (i % 5) * 320}ms`,
            }}
          />
        ))}
      </div>

      {/* Announcement card */}
      <div className="pick-splash-card relative text-center px-6 py-8 max-w-lg mx-4">
        {/* Position-colored glow behind the name */}
        <div
          className="pick-splash-glow"
          style={{ background: `var(--${player.position.toLowerCase()}, var(--accent))` }}
          aria-hidden
        />

        <div className="relative space-y-3">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.25em] text-muted">
            Pick {formatPickLabel(pick.round, pick.pick_in_round)} · #{pick.overall_pick} overall
          </div>

          <div className="text-lg font-bold text-foreground/80">
            {teamName}
            <span className="block text-[10px] font-semibold uppercase tracking-[0.3em] text-muted mt-1">
              selects
            </span>
          </div>

          <div
            className={`pick-splash-name text-4xl sm:text-5xl font-black tracking-tight uppercase leading-none ${posText}`}
          >
            {player.name}
          </div>

          <div className="text-sm font-semibold text-foreground/70">
            {player.position}
            {player.nfl_team && <span className="text-muted"> · {player.nfl_team}</span>}
            {player.bye_week && (
              <span className="text-muted/60 text-xs"> · Bye {player.bye_week}</span>
            )}
          </div>

          {isSteal && (
            <div className="steal-stamp inline-block border-[3px] border-accent text-accent font-black text-xl uppercase tracking-[0.2em] px-4 py-1 rounded-md">
              Steal
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
