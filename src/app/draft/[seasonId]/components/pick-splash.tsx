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
const CONFETTI_COUNT = 44;
const SHARD_COUNT = 22;
const SHARD_COUNT_2 = 16;

// Debris that flies out of the blast and falls under gravity. Golden-angle
// scatter so it looks organic while staying deterministic across renders.
const EMBERS = Array.from({ length: 20 }, (_, i) => {
  const angle = (i * 137.5 * Math.PI) / 180;
  const dist = 120 + (i % 5) * 45;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist * 0.8),
    size: 5 + (i % 3) * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: (i % 4) * 60,
  };
});

/**
 * ESPN headshot for the drafted player, or the team logo for a D/ST (their
 * negative ESPN ids have no headshot). Null when there's nothing to show;
 * the splash also hides the img on a 404 so a missing photo never shows a
 * broken-image icon mid-celebration.
 */
function playerImageUrl(player: Player): string | null {
  if (player.espn_id && !player.espn_id.startsWith("-")) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espn_id}.png`;
  }
  if (player.position === "DEF" && player.nfl_team) {
    return `https://a.espncdn.com/i/teamlogos/nfl/500/${player.nfl_team.toLowerCase()}.png`;
  }
  return null;
}

export function PickSplash({ pick, player, teamName, isSteal, onDone }: PickSplashProps) {
  // Auto-dismiss; the CSS fade-out starts just before this fires so the
  // unmount lands on an already-invisible overlay.
  useEffect(() => {
    const t = setTimeout(onDone, 3400);
    return () => clearTimeout(t);
  }, [pick.id, pick.player_id, onDone]);

  const posText = POS_TEXT[player.position] ?? "text-foreground";
  const posVar = `var(--${player.position.toLowerCase()}, var(--accent))`;
  const imageUrl = playerImageUrl(player);

  return (
    <div
      className="pick-splash"
      onClick={onDone}
      role="status"
      aria-live="polite"
    >
      {/* Confetti rain */}
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

      {/* Full-screen detonation flash */}
      <div className="splash-screenflash" aria-hidden />

      {/* Everything inside jolts with the blast — camera shake, not card wobble */}
      <div className="splash-quake">
        {/* Viewport-scale blast: shockwaves, aftershock, embers, smoke */}
        <div className="blast-layer" aria-hidden>
          <div className="blast-ring" style={{ borderColor: posVar }} />
          <div className="blast-ring blast-ring-2" style={{ borderColor: posVar }} />
          <div className="blast-ring blast-ring-3" style={{ borderColor: posVar }} />
          <div className="blast-ring blast-aftershock" style={{ borderColor: posVar }} />
          {EMBERS.map((e, i) => (
            <span
              key={i}
              className="blast-ember"
              style={{
                "--dx": `${e.dx}px`,
                "--dy": `${e.dy}px`,
                width: `${e.size}px`,
                height: `${e.size}px`,
                background: `var(${e.color})`,
                animationDelay: `${250 + e.delay}ms`,
              } as React.CSSProperties}
            />
          ))}
          {[-90, 0, 90].map((dx, i) => (
            <span
              key={i}
              className="blast-smoke"
              style={{
                "--dx": `${dx}px`,
                animationDelay: `${500 + i * 120}ms`,
              } as React.CSSProperties}
            />
          ))}
        </div>

        {/* Announcement card */}
        <div className="pick-splash-card relative text-center px-6 py-8 max-w-lg mx-4">
          {/* Position-colored glow behind the name */}
          <div
            className="pick-splash-glow"
            style={{ background: posVar }}
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

            {imageUrl && (
              <div className="relative flex justify-center">
                {/* Fireball and shards detonate behind the headshot */}
                <div className="splash-boom" aria-hidden>
                  <div
                    className="splash-flash"
                    style={{
                      background: `radial-gradient(circle, #fff 0%, ${posVar} 30%, transparent 70%)`,
                    }}
                  />
                  {Array.from({ length: SHARD_COUNT }, (_, i) => (
                    <span
                      key={`s1-${i}`}
                      className="splash-shard"
                      style={{
                        "--a": `${i * (360 / SHARD_COUNT)}deg`,
                        "--dist": "240px",
                        background: `var(${CONFETTI_COLORS[i % CONFETTI_COLORS.length]})`,
                      } as React.CSSProperties}
                    />
                  ))}
                  {Array.from({ length: SHARD_COUNT_2 }, (_, i) => (
                    <span
                      key={`s2-${i}`}
                      className="splash-shard splash-shard-2"
                      style={{
                        "--a": `${(i + 0.5) * (360 / SHARD_COUNT_2)}deg`,
                        "--dist": "155px",
                        background: `var(${CONFETTI_COLORS[(i + 3) % CONFETTI_COLORS.length]})`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
                <img
                  src={imageUrl}
                  alt={player.name}
                  className="splash-photo relative w-40 max-h-32 object-contain drop-shadow-2xl"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            )}

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
    </div>
  );
}
