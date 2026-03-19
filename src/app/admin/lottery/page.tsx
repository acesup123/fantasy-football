"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  runLottery,
  simulateLottery,
  LOTTERY_WEIGHTS,
} from "@/lib/draft/lottery";
import type { Owner } from "@/types/database";

// ============================================================
// GIPHY (free public beta key — replace with your own for prod)
// ============================================================
const GIPHY_API_KEY = "dc6zaTOxFJmzC"; // Public beta key

async function searchGif(query: string): Promise<string | null> {
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&rating=pg-13`;
    const resp = await fetch(url);
    const data = await resp.json();
    const gifs = data.data ?? [];
    if (gifs.length === 0) return null;
    // Pick a random one from top 25
    const pick = gifs[Math.floor(Math.random() * gifs.length)];
    return pick.images?.downsized_medium?.url ?? pick.images?.original?.url ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// DEMO DATA
// ============================================================

const DEMO_OWNERS: Owner[] = [
  { id: "1", name: "Alex Altman", team_name: "Return of the GOAT", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: true, created_at: "" },
  { id: "2", name: "Joel Oubre", team_name: "Joe Burrow your picks next year", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "3", name: "Kevin Whitlock", team_name: "Lela's All-Stars", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "4", name: "Ryan Parrilla", team_name: "Lana Rhoades To Victory", email: null, avatar_url: null, joined_year: 2021, is_active: true, is_commissioner: false, created_at: "" },
  { id: "5", name: "Kelly Mann", team_name: "Big Angry Tuna", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "6", name: "Justin Choy", team_name: "Gabriella's a Fox", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "7", name: "Ed Lang", team_name: "New World Order", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "8", name: "Sal Singh", team_name: "Alexis Mi_AMORE", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "9", name: "Navi Singh", team_name: "London Keyes to the Game", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "10", name: "Marcus Moore", team_name: "Smokedcheddathaassgettah", email: null, avatar_url: null, joined_year: 2019, is_active: true, is_commissioner: false, created_at: "" },
  { id: "11", name: "Jason McCartney", team_name: "Diggler's Thunderstick", email: null, avatar_url: null, joined_year: 2010, is_active: true, is_commissioner: false, created_at: "" },
  { id: "12", name: "Lance Michihira", team_name: "dame mas gas-Alina", email: null, avatar_url: null, joined_year: 2018, is_active: true, is_commissioner: false, created_at: "" },
];

const DEMO_2025_STANDINGS = [
  { ownerId: "8", finish: 1 },
  { ownerId: "6", finish: 2 },
  { ownerId: "10", finish: 3 },
  { ownerId: "12", finish: 4 },
  { ownerId: "7", finish: 5 },
  { ownerId: "5", finish: 6 },
  { ownerId: "4", finish: 7 },
  { ownerId: "1", finish: 8 },
  { ownerId: "9", finish: 9 },
  { ownerId: "11", finish: 10 },
  { ownerId: "3", finish: 11 },
  { ownerId: "2", finish: 12 },
];

// ============================================================
// SUSPENSE MESSAGES
// ============================================================

const SUSPENSE_MESSAGES = [
  "The envelope is being opened...",
  "This could change everything...",
  "Who's it going to be...",
  "The tension is real...",
  "Moment of truth...",
  "Here it comes...",
  "And the pick goes to...",
  "The wait is almost over...",
];

const TOP_PICK_MESSAGES = [
  "This is it. The number one overall pick...",
  "The moment everyone's been waiting for...",
  "With the first pick in the 2026 draft...",
];

// Timing per pick position (ms) — builds from ~25s to ~55s per pick
// Total: ~5 minutes
const PICK_TIMING: Record<number, { suspense: number; drumRoll: number; reveal: number }> = {
  8: { suspense: 5000, drumRoll: 12000, reveal: 8000 },
  7: { suspense: 5000, drumRoll: 15000, reveal: 8000 },
  6: { suspense: 6000, drumRoll: 18000, reveal: 8000 },
  5: { suspense: 7000, drumRoll: 22000, reveal: 9000 },
  4: { suspense: 8000, drumRoll: 25000, reveal: 9000 },
  3: { suspense: 9000, drumRoll: 28000, reveal: 10000 },
  2: { suspense: 10000, drumRoll: 32000, reveal: 10000 },
  1: { suspense: 12000, drumRoll: 38000, reveal: 12000 },
};

// ============================================================
// LOTTERY REVEAL PHASES
// ============================================================

type Phase =
  | "idle"           // Not started
  | "intro"          // "Welcome to the lottery" intro
  | "announcing"     // "Now revealing pick #X"
  | "suspense"       // Suspense text cycling
  | "drumroll"       // Drum roll animation
  | "reveal"         // GIF + name reveal
  | "summary"        // Final summary after all picks
  ;

export default function LotteryPage() {
  const [standings] = useState(DEMO_2025_STANDINGS);
  const [lotteryResult, setLotteryResult] = useState<ReturnType<typeof runLottery> | null>(null);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentRevealIndex, setCurrentRevealIndex] = useState(0); // 0 = pick 8, 7 = pick 1
  const [suspenseText, setSuspenseText] = useState("");
  const [revealedGifs, setRevealedGifs] = useState<Map<string, string>>(new Map());
  const [revealedPicks, setRevealedPicks] = useState<number[]>([]);
  const [drumrollIntensity, setDrumrollIntensity] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const drumrollRef = useRef<NodeJS.Timeout | null>(null);

  const ownerMap = useMemo(
    () => new Map(DEMO_OWNERS.map((o) => [o.id, o])),
    []
  );

  const [probabilities, setProbabilities] = useState<Map<string, Map<number, number>>>(new Map());

  // Run simulation client-side only to avoid hydration mismatch
  useEffect(() => {
    setProbabilities(simulateLottery(standings, 50000));
  }, [standings]);

  // Current pick being revealed (8 down to 1)
  const currentPickNumber = lotteryResult
    ? lotteryResult.lotteryResults[lotteryResult.lotteryResults.length - 1 - currentRevealIndex]
    : null;

  const currentOwner = currentPickNumber
    ? ownerMap.get(currentPickNumber.ownerId)
    : null;

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (drumrollRef.current) clearInterval(drumrollRef.current);
    };
  }, []);

  // Pre-fetch GIFs for all lottery winners
  const prefetchGifs = useCallback(
    async (result: ReturnType<typeof runLottery>) => {
      const gifMap = new Map<string, string>();
      for (const pick of result.lotteryResults) {
        const owner = ownerMap.get(pick.ownerId);
        if (owner) {
          const firstName = owner.name.split(" ")[0];
          const gif = await searchGif(`${firstName} funny reaction`);
          if (gif) gifMap.set(pick.ownerId, gif);
        }
      }
      setRevealedGifs(gifMap);
    },
    [ownerMap]
  );

  // Start the lottery
  const startLottery = useCallback(() => {
    const result = runLottery(standings);
    setLotteryResult(result);
    setShowFullscreen(true);
    setPhase("intro");
    setCurrentRevealIndex(0);
    setRevealedPicks([]);
    setDrumrollIntensity(0);

    // Pre-fetch GIFs
    prefetchGifs(result);

    // After intro, start first pick
    timerRef.current = setTimeout(() => {
      revealNextPick(0, result);
    }, 4000);
  }, [standings, prefetchGifs]);

  // Reveal a single pick through all phases
  const revealNextPick = useCallback(
    (index: number, result: ReturnType<typeof runLottery>) => {
      const pickData = result.lotteryResults[result.lotteryResults.length - 1 - index];
      const pickNum = 8 - index;
      const timing = PICK_TIMING[pickNum];

      // Phase 1: Announcing
      setCurrentRevealIndex(index);
      setPhase("announcing");

      timerRef.current = setTimeout(() => {
        // Phase 2: Suspense text
        setPhase("suspense");
        let msgIndex = 0;
        const suspenseInterval = setInterval(() => {
          const messages = pickNum <= 2 ? TOP_PICK_MESSAGES : SUSPENSE_MESSAGES;
          setSuspenseText(messages[msgIndex % messages.length]);
          msgIndex++;
        }, 3000);

        timerRef.current = setTimeout(() => {
          clearInterval(suspenseInterval);

          // Phase 3: Drum roll
          setPhase("drumroll");
          setDrumrollIntensity(0);

          // Ramp up intensity
          let intensity = 0;
          drumrollRef.current = setInterval(() => {
            intensity = Math.min(intensity + 2, 100);
            setDrumrollIntensity(intensity);
          }, timing.drumRoll / 50);

          timerRef.current = setTimeout(() => {
            if (drumrollRef.current) clearInterval(drumrollRef.current);
            setDrumrollIntensity(100);

            // Phase 4: Reveal!
            setPhase("reveal");
            setRevealedPicks((prev) => [...prev, pickData.draftPosition]);

            timerRef.current = setTimeout(() => {
              // Move to next pick or summary
              if (index < 7) {
                revealNextPick(index + 1, result);
              } else {
                setPhase("summary");
              }
            }, timing.reveal);
          }, timing.drumRoll);
        }, timing.suspense);
      }, 3000);
    },
    []
  );

  // Skip to next pick
  const skipToReveal = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (drumrollRef.current) clearInterval(drumrollRef.current);

    if (phase !== "reveal" && phase !== "summary" && lotteryResult) {
      const pickData =
        lotteryResult.lotteryResults[
          lotteryResult.lotteryResults.length - 1 - currentRevealIndex
        ];
      setPhase("reveal");
      setRevealedPicks((prev) => [...prev, pickData.draftPosition]);
      setDrumrollIntensity(100);

      timerRef.current = setTimeout(() => {
        if (currentRevealIndex < 7) {
          revealNextPick(currentRevealIndex + 1, lotteryResult);
        } else {
          setPhase("summary");
        }
      }, 3000);
    }
  }, [phase, lotteryResult, currentRevealIndex, revealNextPick]);

  // Close fullscreen
  const closeLottery = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (drumrollRef.current) clearInterval(drumrollRef.current);
    setShowFullscreen(false);
    setPhase("idle");
  };

  // ============================================================
  // FULLSCREEN LOTTERY EXPERIENCE
  // ============================================================

  if (showFullscreen && lotteryResult) {
    const pickNum = 8 - currentRevealIndex;
    const gifUrl = currentPickNumber ? revealedGifs.get(currentPickNumber.ownerId) : null;

    return (
      <div className="fixed inset-0 z-50 bg-[#050a10] flex flex-col items-center justify-center overflow-hidden">
        {/* Animated background */}
        <div
          className="absolute inset-0 transition-opacity duration-1000"
          style={{
            background:
              phase === "drumroll"
                ? `radial-gradient(circle at 50% 50%, rgba(0,229,176,${drumrollIntensity * 0.002}) 0%, transparent 70%)`
                : phase === "reveal"
                ? "radial-gradient(circle at 50% 50%, rgba(0,229,176,0.15) 0%, transparent 60%)"
                : "none",
          }}
        />

        {/* Pulsing border on drumroll */}
        {phase === "drumroll" && (
          <div
            className="absolute inset-0 border-4 transition-all"
            style={{
              borderColor: `rgba(0,229,176,${drumrollIntensity * 0.008})`,
              boxShadow: `inset 0 0 ${drumrollIntensity}px rgba(0,229,176,${drumrollIntensity * 0.005})`,
            }}
          />
        )}

        {/* Skip button */}
        {phase !== "summary" && phase !== "idle" && (
          <button
            onClick={skipToReveal}
            className="absolute top-4 right-4 text-xs text-muted/40 hover:text-muted transition-colors z-10"
          >
            Skip →
          </button>
        )}

        {/* Close button */}
        <button
          onClick={closeLottery}
          className="absolute top-4 left-4 text-xs text-muted/40 hover:text-muted transition-colors z-10"
        >
          ✕ Exit
        </button>

        {/* Already revealed picks — ticker at top */}
        {revealedPicks.length > 0 && phase !== "summary" && (
          <div className="absolute top-12 left-0 right-0 flex justify-center gap-3 px-4">
            {[...lotteryResult.lotteryResults]
              .reverse()
              .filter((_, i) => i < currentRevealIndex + (phase === "reveal" ? 1 : 0))
              .map((pick, i) => {
                const o = ownerMap.get(pick.ownerId);
                return (
                  <div
                    key={pick.draftPosition}
                    className="text-center fade-in"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className="text-[10px] text-muted/50 font-mono">
                      #{8 - i}
                    </div>
                    <div className="text-xs font-semibold text-muted/70">
                      {o?.name.split(" ")[0]}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* INTRO PHASE */}
        {phase === "intro" && (
          <div className="text-center fade-in">
            <div className="text-6xl font-black tracking-tighter mb-4">
              <span className="bg-gradient-to-r from-accent via-gold to-accent bg-clip-text text-transparent">
                BANL DRAFT LOTTERY
              </span>
            </div>
            <div className="text-xl text-muted font-medium">2026 Season</div>
            <div className="mt-8 text-sm text-muted/50">
              8 picks. 8 destinies. Let&apos;s go.
            </div>
          </div>
        )}

        {/* ANNOUNCING PHASE */}
        {phase === "announcing" && (
          <div className="text-center fade-in">
            <div className="text-muted/50 text-sm uppercase tracking-[0.3em] mb-4">
              Now Revealing
            </div>
            <div
              className={`font-black tracking-tight ${
                pickNum <= 2
                  ? "text-8xl text-gold"
                  : pickNum <= 4
                  ? "text-7xl text-accent"
                  : "text-6xl text-foreground"
              }`}
            >
              PICK #{pickNum}
            </div>
            <div className="mt-4 text-muted text-sm">
              {pickNum === 1
                ? "The #1 overall pick in the 2026 BANL Draft"
                : `The ${pickNum}${pickNum === 2 ? "nd" : pickNum === 3 ? "rd" : "th"} pick`}
            </div>
          </div>
        )}

        {/* SUSPENSE PHASE */}
        {phase === "suspense" && (
          <div className="text-center">
            <div className="text-muted/30 text-sm uppercase tracking-[0.3em] mb-6">
              Pick #{pickNum}
            </div>
            <div className="text-2xl text-muted italic font-medium fade-in" key={suspenseText}>
              &ldquo;{suspenseText}&rdquo;
            </div>
            {/* Remaining teams still in the draw */}
            <div className="mt-12 flex flex-wrap justify-center gap-3">
              {lotteryResult.lotteryResults
                .filter((p) => !revealedPicks.includes(p.draftPosition))
                .map((p) => {
                  const o = ownerMap.get(p.ownerId);
                  return (
                    <div
                      key={p.ownerId}
                      className="px-3 py-1.5 bg-card/50 border border-border/30 rounded-lg text-xs font-medium text-muted/60"
                    >
                      {o?.name.split(" ")[0]} ({p.weight}%)
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* DRUMROLL PHASE */}
        {phase === "drumroll" && (
          <div className="text-center">
            <div className="text-muted/30 text-sm uppercase tracking-[0.3em] mb-6">
              Pick #{pickNum}
            </div>

            {/* Spinning name roulette effect */}
            <div className="relative h-24 overflow-hidden mb-8">
              <div
                className="absolute inset-x-0"
                style={{
                  animation: `spin-names ${Math.max(0.1, 2 - drumrollIntensity * 0.018)}s linear infinite`,
                }}
              >
                {lotteryResult.lotteryResults
                  .filter((p) => !revealedPicks.includes(p.draftPosition))
                  .map((p, i) => {
                    const o = ownerMap.get(p.ownerId);
                    return (
                      <div
                        key={p.ownerId}
                        className="text-4xl font-black text-center py-2"
                        style={{
                          color: `rgba(232,237,242,${0.3 + drumrollIntensity * 0.007})`,
                        }}
                      >
                        {o?.name}
                      </div>
                    );
                  })}
              </div>
              {/* Gradient masks */}
              <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#050a10] to-transparent z-10" />
              <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#050a10] to-transparent z-10" />
            </div>

            {/* Intensity bar */}
            <div className="w-64 mx-auto h-2 bg-border/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${drumrollIntensity}%`,
                  background:
                    drumrollIntensity > 80
                      ? "var(--gold)"
                      : drumrollIntensity > 50
                      ? "var(--accent)"
                      : "var(--muted)",
                  boxShadow:
                    drumrollIntensity > 80
                      ? "0 0 20px rgba(255,215,0,0.5)"
                      : "none",
                }}
              />
            </div>
          </div>
        )}

        {/* REVEAL PHASE */}
        {phase === "reveal" && currentOwner && (
          <div className="text-center space-y-6 fade-in">
            {/* GIF */}
            {gifUrl && (
              <div className="w-80 h-60 mx-auto rounded-xl overflow-hidden border-2 border-accent/40 shadow-lg shadow-accent/20">
                <img
                  src={gifUrl}
                  alt={currentOwner.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Pick number */}
            <div className="text-muted/50 text-sm uppercase tracking-[0.3em]">
              Pick #{pickNum}
            </div>

            {/* Owner name — big reveal */}
            <div
              className={`font-black tracking-tight ${
                pickNum === 1
                  ? "text-7xl text-gold"
                  : pickNum <= 3
                  ? "text-6xl text-accent"
                  : "text-5xl text-foreground"
              }`}
              style={{
                textShadow:
                  pickNum === 1
                    ? "0 0 40px rgba(255,215,0,0.4)"
                    : pickNum <= 3
                    ? "0 0 30px rgba(0,229,176,0.3)"
                    : "none",
              }}
            >
              {currentOwner.name.toUpperCase()}
            </div>

            {/* Team name + details */}
            <div className="text-muted text-sm">
              {currentOwner.team_name}
              <span className="text-muted/40 ml-2">
                Finished {currentPickNumber?.finish}th — {currentPickNumber?.weight}% odds
              </span>
            </div>

            {/* Celebration particles for top 3 */}
            {pickNum <= 3 && (
              <div className="text-4xl animate-bounce">
                {pickNum === 1 ? "👑" : pickNum === 2 ? "🔥" : "⚡"}
              </div>
            )}
          </div>
        )}

        {/* SUMMARY PHASE */}
        {phase === "summary" && (
          <div className="text-center max-w-2xl mx-auto px-4 fade-in">
            <div className="text-4xl font-black mb-8">
              <span className="bg-gradient-to-r from-accent via-gold to-accent bg-clip-text text-transparent">
                2026 DRAFT ORDER
              </span>
            </div>

            <div className="space-y-2 mb-8">
              {/* Lottery picks */}
              {lotteryResult.lotteryResults.map((pick) => {
                const o = ownerMap.get(pick.ownerId);
                const gif = revealedGifs.get(pick.ownerId);
                return (
                  <div
                    key={pick.draftPosition}
                    className={`flex items-center gap-4 px-4 py-3 rounded-xl ${
                      pick.draftPosition === 1
                        ? "bg-gold/10 border border-gold/30"
                        : pick.draftPosition <= 3
                        ? "bg-accent/10 border border-accent/20"
                        : "bg-card/50 border border-border/30"
                    }`}
                  >
                    <span
                      className={`text-2xl font-black w-10 text-center ${
                        pick.draftPosition === 1
                          ? "text-gold"
                          : pick.draftPosition <= 3
                          ? "text-accent"
                          : "text-muted"
                      }`}
                    >
                      {pick.draftPosition}
                    </span>
                    {gif && (
                      <img
                        src={gif}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1 text-left">
                      <div className="font-bold text-sm">{o?.name}</div>
                      <div className="text-[10px] text-muted">
                        {o?.team_name} — {pick.weight}% odds
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Divider */}
              <div className="py-2 text-[10px] text-muted/40 uppercase tracking-wider">
                Locked Slots
              </div>

              {/* Locked picks */}
              {lotteryResult.lockedSlots
                .sort((a, b) => a.draftPosition - b.draftPosition)
                .map((slot) => {
                  const o = ownerMap.get(slot.ownerId);
                  return (
                    <div
                      key={slot.draftPosition}
                      className="flex items-center gap-4 px-4 py-2 rounded-xl bg-background/20"
                    >
                      <span className="text-2xl font-black w-10 text-center text-muted/40">
                        {slot.draftPosition}
                      </span>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-sm text-muted/70">
                          {o?.name}
                        </div>
                        <div className="text-[10px] text-muted/40">
                          Finished {slot.finish}
                          {slot.finish === 1 ? "st" : slot.finish === 2 ? "nd" : slot.finish === 3 ? "rd" : "th"}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted/30 uppercase">
                        Locked
                      </span>
                    </div>
                  );
                })}
            </div>

            <button onClick={closeLottery} className="btn-primary px-8 py-3">
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // NORMAL VIEW (pre-lottery)
  // ============================================================

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <a href="/admin" className="text-xs text-muted hover:text-accent">
          ← Back to Admin
        </a>
        <h1 className="text-3xl font-black mt-2">Draft Order Lottery</h1>
        <p className="text-muted text-sm mt-1">
          Top 4 teams draft in reverse order (9-12). Bottom 8 enter a weighted
          lottery for picks 1-8.
        </p>
      </div>

      {/* Rules */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h2 className="font-bold text-sm mb-3">How It Works</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Locked Slots (Top 4)
            </h3>
            <div className="space-y-1 text-xs">
              <div>1st place → Picks <span className="font-bold">12th</span></div>
              <div>2nd place → Picks <span className="font-bold">11th</span></div>
              <div>3rd place → Picks <span className="font-bold">10th</span></div>
              <div>4th place → Picks <span className="font-bold">9th</span></div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Lottery Weights (Bottom 8)
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {Object.entries(LOTTERY_WEIGHTS)
                .sort(([, a], [, b]) => b - a)
                .map(([finish, weight]) => (
                  <div key={finish} className="flex justify-between">
                    <span className="text-muted">{finish}th place</span>
                    <span className="font-bold text-accent">{weight}%</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Standings */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-bold text-sm">2025 Final Standings</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border/50">
              <th className="text-left px-4 py-2">Finish</th>
              <th className="text-left px-4 py-2">Owner</th>
              <th className="text-left px-4 py-2">Team</th>
              <th className="text-center px-4 py-2">Weight</th>
              <th className="text-center px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const owner = ownerMap.get(s.ownerId);
              const isLocked = s.finish <= 4;
              const weight = LOTTERY_WEIGHTS[s.finish];
              return (
                <tr
                  key={s.ownerId}
                  className={`border-b border-border/20 ${isLocked ? "bg-card-elevated/30" : ""}`}
                >
                  <td className="px-4 py-2 text-sm font-bold">{s.finish}</td>
                  <td className="px-4 py-2 text-sm">{owner?.name}</td>
                  <td className="px-4 py-2 text-xs text-muted">{owner?.team_name}</td>
                  <td className="px-4 py-2 text-center">
                    {weight ? (
                      <span className="text-xs font-bold text-accent">{weight}%</span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {isLocked ? (
                      <span className="text-[10px] font-bold bg-muted/20 text-muted px-2 py-0.5 rounded">
                        LOCKED → Pick {13 - s.finish}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold bg-accent/10 text-accent px-2 py-0.5 rounded">
                        IN LOTTERY
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Probability Matrix */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-bold text-sm">
            Probability Matrix
            <span className="text-xs text-muted font-normal ml-2">(50k sims)</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border/50">
                <th className="text-left px-3 py-2">Owner</th>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((pick) => (
                  <th key={pick} className="text-center px-2 py-2 w-14">#{pick}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings
                .filter((s) => s.finish > 4)
                .sort((a, b) => (LOTTERY_WEIGHTS[b.finish] ?? 0) - (LOTTERY_WEIGHTS[a.finish] ?? 0))
                .map((s) => {
                  const owner = ownerMap.get(s.ownerId);
                  const probs = probabilities.get(s.ownerId);
                  return (
                    <tr key={s.ownerId} className="border-b border-border/20">
                      <td className="px-3 py-2">
                        <div className="text-xs font-semibold">{owner?.name}</div>
                        <div className="text-[10px] text-muted">
                          {s.finish}th — {LOTTERY_WEIGHTS[s.finish]}%
                        </div>
                      </td>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((pick) => {
                        const pct = probs?.get(pick) ?? 0;
                        const intensity = Math.min(pct / 40, 1);
                        return (
                          <td key={pick} className="text-center px-2 py-2">
                            <span
                              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `rgba(0,229,176,${intensity * 0.3})`,
                                color: pct > 15 ? "var(--accent)" : pct > 5 ? "var(--foreground)" : "var(--muted)",
                              }}
                            >
                              {pct > 0 ? `${pct.toFixed(1)}%` : "—"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Launch Button */}
      <div className="text-center py-8">
        <button onClick={startLottery} className="btn-primary text-lg px-10 py-4 font-black">
          🎰 Run the Lottery
        </button>
        <p className="text-xs text-muted mt-2">
          Full-screen experience — ~5 minutes with dramatic reveals + GIFs
        </p>
      </div>
    </div>
  );
}
