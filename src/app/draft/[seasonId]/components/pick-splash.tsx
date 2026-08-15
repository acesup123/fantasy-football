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
  /** League-roast mode: clowns instead of confetti, wobble instead of boom. */
  roast?: boolean;
  onDone: () => void;
}

const POS_TEXT: Record<string, string> = {
  QB: "text-qb",
  RB: "text-rb",
  WR: "text-wr",
  TE: "text-te",
  DEF: "text-def",
};

// Everything below is index math instead of Math.random so a re-render
// mid-animation doesn't reshuffle the scene.
const CONFETTI_COLORS = ["--qb", "--rb", "--wr", "--te", "--def", "--accent"];
const CONFETTI_COUNT = 44;
const SHARD_COUNT = 22;
const SHARD_COUNT_2 = 16;

// Debris blown out of the blast that falls under gravity. Golden-angle
// scatter so it looks organic while staying deterministic.
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

// Flames that lick up over the bottom of the headshot once the blast lands.
const FLAMES = Array.from({ length: 10 }, (_, i) => ({
  left: -63 + i * 14,
  width: 14 + (i % 4) * 5,
  height: 26 + (i % 3) * 12,
  duration: 850 + (i % 3) * 180,
  delay: (i % 5) * 120,
}));

// Fireworks: a rocket streaks up, then a spark shower blooms where it dies.
// One golden, one in the position color, one ice-white — staggered so the
// sky keeps popping after the main blast.
const FW_SPARKS = Array.from({ length: 16 }, (_, i) => {
  const a = (i * 22.5 * Math.PI) / 180;
  const d = 62 + (i % 3) * 24;
  return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d) };
});

const FIREWORKS: { x: string; y: string; rise: string; delay: number; color: string | null }[] = [
  { x: "18%", y: "30%", rise: "70vh", delay: 900, color: "#ffd76a" },
  { x: "80%", y: "24%", rise: "76vh", delay: 1300, color: null }, // position color
  { x: "50%", y: "14%", rise: "86vh", delay: 1700, color: "#bfe9ff" },
];

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

export function PickSplash({ pick, player, teamName, isSteal, roast = false, onDone }: PickSplashProps) {
  // Auto-dismiss; the CSS fade-out starts just before this fires so the
  // unmount lands on an already-invisible overlay.
  useEffect(() => {
    const t = setTimeout(onDone, 4300);
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
      {/* Confetti rain — or clown rain, depending on who's picking */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {Array.from({ length: CONFETTI_COUNT }, (_, i) =>
          roast ? (
            <span
              key={i}
              className="clown-piece"
              style={{
                left: `${(i * 37 + 11) % 100}%`,
                fontSize: `${18 + (i % 3) * 8}px`,
                animationDelay: `${(i % 7) * 110}ms`,
                animationDuration: `${2400 + (i % 5) * 320}ms`,
              }}
            >
              🤡
            </span>
          ) : (
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
          )
        )}
      </div>

      {/* Full-screen detonation flash — double pop. The roast doesn't rate one. */}
      {!roast && <div className="splash-screenflash" aria-hidden />}

      {/* Fireworks bloom around the card after the main blast */}
      {!roast && (
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {FIREWORKS.map((fw, f) => {
          const color = fw.color ?? posVar;
          return (
            <div key={f}>
              <span
                className="fw-rocket"
                style={{
                  left: fw.x,
                  "--rise": fw.rise,
                  background: `linear-gradient(to top, transparent, ${color})`,
                  animationDelay: `${fw.delay - 450}ms`,
                } as React.CSSProperties}
              />
              <div className="fw-burst" style={{ left: fw.x, top: fw.y }}>
                {FW_SPARKS.map((s, i) => (
                  <span
                    key={i}
                    className="fw-spark"
                    style={{
                      "--dx": `${s.dx}px`,
                      "--dy": `${s.dy}px`,
                      background: i % 3 === 0 ? "#ffffff" : color,
                      animationDelay: `${fw.delay + (i % 4) * 40}ms`,
                    } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Everything inside jolts with the blast — camera shake, not card wobble.
          Roast picks don't quake; they wilt. */}
      <div className={roast ? "splash-quake splash-quake-still" : "splash-quake"}>
        {/* Viewport-scale blast: shockwaves, aftershock, embers, smoke */}
        {!roast && (
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
        )}

        {/* Announcement card */}
        <div
          className={`pick-splash-card ${
            roast ? "pick-splash-card-sad" : ""
          } relative text-center px-6 py-8 max-w-lg mx-4`}
        >
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
                {!roast && (
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
                )}
                <img
                  src={imageUrl}
                  alt={player.name}
                  className="splash-photo relative w-40 max-h-32 object-contain drop-shadow-2xl"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {/* The player is on fire: glow plus flames licking up the headshot */}
                {!roast && (
                <div className="splash-fire" aria-hidden>
                  <div className="splash-fireglow" />
                  {FLAMES.map((f, i) => (
                    <span
                      key={i}
                      className="splash-flame"
                      style={{
                        left: `calc(50% + ${f.left}px)`,
                        width: `${f.width}px`,
                        height: `${f.height}px`,
                        "--fd": `${f.duration}ms`,
                        "--fdel": `${500 + f.delay}ms`,
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
                )}
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

            {roast ? (
              <div
                className="steal-stamp inline-block border-[3px] font-black text-xl uppercase tracking-[0.2em] px-4 py-1 rounded-md"
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              >
                Marcus Special 🤡
              </div>
            ) : (
              isSteal && (
                <div className="steal-stamp inline-block border-[3px] border-accent text-accent font-black text-xl uppercase tracking-[0.2em] px-4 py-1 rounded-md">
                  Steal
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
