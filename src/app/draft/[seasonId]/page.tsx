"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { DraftBoard, type BoardView } from "./components/draft-board";
import { PlayerPool } from "./components/player-pool";
import { DraftControls } from "./components/draft-controls";
import { TradeModal } from "./components/trade-modal";
import { LiveTicker } from "./components/live-ticker";
import { PickSplash } from "./components/pick-splash";
import type { DraftPick, Player, Owner, Season, Trade } from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { subscribeToDraft } from "@/lib/draft/subscriptions";
import { buildOwnerRosters } from "@/lib/draft/roster-requirements";
import { findLastLivePick } from "@/lib/draft/undo";
import { useAuth } from "@/components/auth/auth-provider";

// ============================================================
// DEMO DATA — fallback when no Supabase data is available
// ============================================================
const TEAM_NAMES = [
  "Mahomes' Militia", "King Henry's Court", "Jefferson Airplane",
  "Kelce's Kitchen", "Chase the Dream", "Hurts So Good",
  "Lamar's Llamas", "Breece Lightning", "Diggs Deep",
  "Amon-Ra Vision", "Bijan Mustard", "Ceedee's Nuts",
];

const DEMO_OWNERS: Owner[] = TEAM_NAMES.map((name, i) => ({
  id: `owner-${i + 1}`,
  name: name,
  email: null,
  team_name: name,
  avatar_url: null,
  joined_year: 2020,
  is_active: true,
  is_commissioner: i === 0,
  created_at: new Date().toISOString(),
}));

const DEMO_PLAYERS: Player[] = [
  // QBs
  { id: 1, name: "Patrick Mahomes", position: "QB", nfl_team: "KC", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 2, name: "Josh Allen", position: "QB", nfl_team: "BUF", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 3, name: "Lamar Jackson", position: "QB", nfl_team: "BAL", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 4, name: "Jalen Hurts", position: "QB", nfl_team: "PHI", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 5, name: "Joe Burrow", position: "QB", nfl_team: "CIN", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 6, name: "C.J. Stroud", position: "QB", nfl_team: "HOU", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 7, name: "Anthony Richardson", position: "QB", nfl_team: "IND", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 8, name: "Jayden Daniels", position: "QB", nfl_team: "WAS", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 9, name: "Caleb Williams", position: "QB", nfl_team: "CHI", espn_id: null, bye_week: 7, is_active: true, created_at: "" },
  { id: 10, name: "Dak Prescott", position: "QB", nfl_team: "DAL", espn_id: null, bye_week: 7, is_active: true, created_at: "" },
  // RBs
  { id: 20, name: "Christian McCaffrey", position: "RB", nfl_team: "SF", espn_id: null, bye_week: 9, is_active: true, created_at: "" },
  { id: 21, name: "Bijan Robinson", position: "RB", nfl_team: "ATL", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 22, name: "Breece Hall", position: "RB", nfl_team: "NYJ", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 23, name: "Derrick Henry", position: "RB", nfl_team: "BAL", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 24, name: "Saquon Barkley", position: "RB", nfl_team: "PHI", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 25, name: "Jahmyr Gibbs", position: "RB", nfl_team: "DET", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 26, name: "Jonathan Taylor", position: "RB", nfl_team: "IND", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 27, name: "Travis Etienne", position: "RB", nfl_team: "JAX", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 28, name: "Kenneth Walker III", position: "RB", nfl_team: "SEA", espn_id: null, bye_week: 10, is_active: true, created_at: "" },
  { id: 29, name: "De'Von Achane", position: "RB", nfl_team: "MIA", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 30, name: "Josh Jacobs", position: "RB", nfl_team: "GB", espn_id: null, bye_week: 10, is_active: true, created_at: "" },
  { id: 31, name: "Isiah Pacheco", position: "RB", nfl_team: "KC", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  // WRs
  { id: 40, name: "Ja'Marr Chase", position: "WR", nfl_team: "CIN", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 41, name: "Tyreek Hill", position: "WR", nfl_team: "MIA", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 42, name: "CeeDee Lamb", position: "WR", nfl_team: "DAL", espn_id: null, bye_week: 7, is_active: true, created_at: "" },
  { id: 43, name: "Justin Jefferson", position: "WR", nfl_team: "MIN", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 44, name: "Amon-Ra St. Brown", position: "WR", nfl_team: "DET", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 45, name: "A.J. Brown", position: "WR", nfl_team: "PHI", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 46, name: "Garrett Wilson", position: "WR", nfl_team: "NYJ", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 47, name: "Puka Nacua", position: "WR", nfl_team: "LAR", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 48, name: "Marvin Harrison Jr.", position: "WR", nfl_team: "ARI", espn_id: null, bye_week: 11, is_active: true, created_at: "" },
  { id: 49, name: "Davante Adams", position: "WR", nfl_team: "NYJ", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 50, name: "Chris Olave", position: "WR", nfl_team: "NO", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 51, name: "Drake London", position: "WR", nfl_team: "ATL", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  // TEs
  { id: 60, name: "Travis Kelce", position: "TE", nfl_team: "KC", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 61, name: "Sam LaPorta", position: "TE", nfl_team: "DET", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 62, name: "Mark Andrews", position: "TE", nfl_team: "BAL", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
  { id: 63, name: "T.J. Hockenson", position: "TE", nfl_team: "MIN", espn_id: null, bye_week: 6, is_active: true, created_at: "" },
  { id: 64, name: "Dallas Goedert", position: "TE", nfl_team: "PHI", espn_id: null, bye_week: 5, is_active: true, created_at: "" },
  { id: 65, name: "George Kittle", position: "TE", nfl_team: "SF", espn_id: null, bye_week: 9, is_active: true, created_at: "" },
  // DEFs
  { id: 80, name: "49ers D/ST", position: "DEF", nfl_team: "SF", espn_id: null, bye_week: 9, is_active: true, created_at: "" },
  { id: 81, name: "Cowboys D/ST", position: "DEF", nfl_team: "DAL", espn_id: null, bye_week: 7, is_active: true, created_at: "" },
  { id: 82, name: "Bills D/ST", position: "DEF", nfl_team: "BUF", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 83, name: "Jets D/ST", position: "DEF", nfl_team: "NYJ", espn_id: null, bye_week: 12, is_active: true, created_at: "" },
  { id: 84, name: "Browns D/ST", position: "DEF", nfl_team: "CLE", espn_id: null, bye_week: 10, is_active: true, created_at: "" },
  { id: 85, name: "Ravens D/ST", position: "DEF", nfl_team: "BAL", espn_id: null, bye_week: 14, is_active: true, created_at: "" },
];

const DEMO_SEASON: Season = {
  id: 1,
  year: 2026,
  draft_status: "drafting",
  draft_order: DEMO_OWNERS.map((o) => o.id),
  pick_timer_seconds: 120,
  current_pick_number: 13,
  draft_started_at: new Date().toISOString(),
  trade_deadline: null,
  is_current: true,
  created_at: new Date().toISOString(),
};

export default function DraftPage() {
  const params = useParams<{ seasonId: string }>();
  const seasonId = params.seasonId;
  const { owner: authOwner } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [season, setSeason] = useState<Season | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [pendingTrades, setPendingTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [boardView, setBoardView] = useState<BoardView>("board");
  const [recentPickId, setRecentPickId] = useState<number | undefined>(undefined);
  const [pickError, setPickError] = useState<string | null>(null);
  const [splashPick, setSplashPick] = useState<DraftPick | null>(null);

  const subscriptionsRef = useRef<{ unsubscribeAll: () => void } | null>(null);
  // Your own pick arrives twice — once optimistically, once over realtime —
  // so splashes are deduped. Keyed on slot + player, not just slot, so an
  // undone pick that gets re-made with a different player still announces.
  const announcedRef = useRef<Set<string>>(new Set());

  const announcePick = useCallback((pick: DraftPick) => {
    if (!pick.player_id || pick.is_keeper) return;
    const key = `${pick.id}:${pick.player_id}`;
    if (announcedRef.current.has(key)) return;
    announcedRef.current.add(key);
    setSplashPick(pick);
  }, []);

  const clearSplash = useCallback(() => setSplashPick(null), []);

  // ---- Fetch initial data ----
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch season — try by year first, then by id
        let seasonData: Season | null = null;
        const yearNum = parseInt(seasonId, 10);

        if (!isNaN(yearNum) && yearNum >= 2000 && yearNum <= 2100) {
          // Looks like a year
          const { data } = await supabase
            .from("seasons")
            .select("*")
            .eq("year", yearNum)
            .single();
          seasonData = data;
        }

        if (!seasonData) {
          // Try as a direct season ID
          const { data } = await supabase
            .from("seasons")
            .select("*")
            .eq("id", seasonId)
            .single();
          seasonData = data;
        }

        if (cancelled) return;

        if (!seasonData) {
          setError(`Season "${seasonId}" not found`);
          setLoading(false);
          return;
        }

        // Fetch owners, picks, players, and pending trades in parallel
        const [ownersRes, picksRes, playersRes, tradesRes] = await Promise.all([
          supabase
            .from("owners")
            .select("*")
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("draft_picks")
            .select("*")
            .eq("season_id", seasonData.id)
            .order("overall_pick"),
          supabase
            .from("players")
            .select("*")
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("trades")
            .select("*")
            .eq("season_id", seasonData.id)
            .eq("status", "pending"),
        ]);

        if (cancelled) return;

        setSeason(seasonData);
        setOwners(ownersRes.data ?? []);
        setPicks(picksRes.data ?? []);
        setPlayers(playersRes.data ?? []);
        setPendingTrades(tradesRes.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load draft data");
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [seasonId, supabase]);

  // ---- Real-time subscriptions ----
  useEffect(() => {
    if (!season) return;

    const subs = subscribeToDraft(supabase, season.id, {
      onPick: (updatedPick: DraftPick) => {
        setPicks((prev) => {
          const idx = prev.findIndex((p) => p.id === updatedPick.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updatedPick;
            return next;
          }
          // New pick — insert in order
          return [...prev, updatedPick].sort(
            (a, b) => a.overall_pick - b.overall_pick
          );
        });

        // Flash the recent pick
        if (updatedPick.player_id) {
          setRecentPickId(updatedPick.id);
          setTimeout(() => setRecentPickId(undefined), 2000);
        }

        // Full-screen announcement — everyone sees the celebration, whoever
        // made the pick. announcePick skips keepers and dedupes the echo of
        // your own optimistic pick.
        announcePick(updatedPick);
      },
      onTrade: (trade: Trade) => {
        setPendingTrades((prev) => {
          if (trade.status === "pending") {
            const exists = prev.find((t) => t.id === trade.id);
            return exists
              ? prev.map((t) => (t.id === trade.id ? trade : t))
              : [...prev, trade];
          }
          // No longer pending — remove
          return prev.filter((t) => t.id !== trade.id);
        });
      },
      onStatusChange: (updated: Partial<Season>) => {
        setSeason((prev) =>
          prev ? { ...prev, ...updated } : prev
        );
      },
    });

    subscriptionsRef.current = subs;

    return () => {
      subs.unsubscribeAll();
      subscriptionsRef.current = null;
    };
  }, [season?.id, supabase, announcePick]);

  // ---- Derived state ----
  const currentOwnerId = authOwner?.id ?? "";

  const currentPickNumber = season?.current_pick_number ?? 1;
  const currentPick = picks.find((p) => p.overall_pick === currentPickNumber);
  // On deck is the next slot an owner will actually pick, not overall_pick + 1:
  // keeper slots are pre-filled at initialization, and after an undo the slots
  // just past the pointer may already hold picks.
  const nextPick = picks.find(
    (p) =>
      p.overall_pick > currentPickNumber && !p.is_keeper && p.player_id === null
  );
  const isMyTurn = currentPick?.current_owner_id === currentOwnerId;


  const draftedPlayerIds = useMemo(
    () => new Set(picks.filter((p) => p.player_id !== null).map((p) => p.player_id)),
    [picks]
  );
  // ESPN draft ranks so the pool can be ordered by value. Kept out of the
  // players table because they shift through the preseason; the pool falls
  // back to alphabetical if this fails, so a draft is never blocked on it.
  const [ranks, setRanks] = useState<Record<string, { rank: number; adp: number | null }>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/players/ranks?season=${new Date().getFullYear()}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled && data?.ranks) setRanks(data.ranks);
      } catch {
        // Leave ranks empty — the pool stays alphabetical.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const availablePlayers = useMemo(
    () => players.filter((p) => !draftedPlayerIds.has(p.id)),
    [players, draftedPlayerIds]
  );

  const ownerMap = useMemo(
    () => new Map(owners.map((o) => [o.id, o])),
    [owners]
  );
  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players]
  );

  // The API already lets a commissioner act for another owner (canActAs), and
  // they routinely enter picks for absent owners. Surface that on the board.
  const isCommissioner = Boolean(authOwner?.is_commissioner);
  const canPickNow = isMyTurn || isCommissioner;
  const pickingForName =
    !isMyTurn && isCommissioner && currentPick
      ? ownerMap.get(currentPick.current_owner_id)?.name ?? "another owner"
      : null;

  // What the roster on the clock still owes the minimums. Drives the pool's
  // lockout so the API's rejection isn't the first anyone hears of it.
  // Keyed to whoever holds the pick, not the signed-in user — a commissioner
  // entering a pick for an absent owner must respect that owner's roster.
  const pickingForOwnerId = currentPick?.current_owner_id ?? null;
  const myRequirements = useMemo(() => {
    if (!pickingForOwnerId) return null;
    return (
      buildOwnerRosters(picks, playerMap).get(pickingForOwnerId)?.requirements ?? null
    );
  }, [picks, playerMap, pickingForOwnerId]);

  // ---- Make a pick (POST to API) ----
  const makePick = useCallback(
    async (playerId: number) => {
      if (!canPickNow || !currentPick || !season) return;
      setPickError(null);

      try {
        const res = await fetch("/api/draft/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season_id: season.id,
            overall_pick: currentPickNumber,
            player_id: playerId,
            // The owner whose pick this is — a commissioner may be entering
            // it on their behalf. requireActingOwner authorises that.
            owner_id: currentPick.current_owner_id,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setPickError(data.error ?? "Failed to make pick");
          return;
        }

        // Optimistic update (real-time will also fire)
        setRecentPickId(currentPick.id);
        setPicks((prev) =>
          prev.map((p) =>
            p.overall_pick === currentPickNumber
              ? { ...p, player_id: playerId, picked_at: new Date().toISOString() }
              : p
          )
        );
        announcePick({
          ...currentPick,
          player_id: playerId,
          picked_at: new Date().toISOString(),
        });
        // The server tells us where the pointer landed. Assuming +1 lands on a
        // keeper slot — 60 of the 180 are pre-filled — and stalls the board.
        setSeason((prev) =>
          prev
            ? {
                ...prev,
                current_pick_number: data.next_pick ?? null,
                draft_status: data.draft_complete ? "complete" : prev.draft_status,
              }
            : prev
        );
        setTimeout(() => setRecentPickId(undefined), 2000);
      } catch {
        setPickError("Network error — try again");
      }
    },
    [canPickNow, currentPick, season, currentPickNumber, announcePick]
  );

  // ---- Undo the last pick (commissioner only) ----
  //
  // The same rule the API uses, so the button names the pick the server will
  // actually reverse rather than guessing at the highest-numbered one.
  const lastLivePick = useMemo(() => findLastLivePick(picks), [picks]);

  const undoTarget = useMemo(() => {
    if (!isCommissioner || !lastLivePick?.player_id) return null;
    return {
      overallPick: lastLivePick.overall_pick,
      playerName: playerMap.get(lastLivePick.player_id)?.name ?? "this pick",
      teamName: ownerMap.get(lastLivePick.current_owner_id)?.team_name ?? "unknown team",
    };
  }, [isCommissioner, lastLivePick, playerMap, ownerMap]);

  const undoLastPick = useCallback(async () => {
    if (!season || !lastLivePick) return;
    setPickError(null);

    try {
      const res = await fetch("/api/draft/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_id: season.id,
          // Name the slot explicitly. If a pick lands between the render and
          // the click, the server rejects the stale target instead of
          // reversing whatever happens to be newest by then.
          overall_pick: lastLivePick.overall_pick,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPickError(data.error ?? "Failed to undo the pick");
        return;
      }

      // Realtime also fires for both of these, but update straight away so the
      // player is back in the pool the moment the button resolves.
      setPicks((prev) =>
        prev.map((p) =>
          p.overall_pick === lastLivePick.overall_pick
            ? { ...p, player_id: null, picked_at: null, is_auto_pick: false }
            : p
        )
      );
      setSeason((prev) =>
        prev
          ? { ...prev, current_pick_number: data.on_the_clock, draft_status: "drafting" }
          : prev
      );
    } catch {
      setPickError("Network error — the pick was not undone");
    }
  }, [season, lastLivePick]);

  // ---- Use demo data as fallback ----
  const useDemoData =
    !loading && !season && !error;

  const displaySeason = season ?? (useDemoData ? DEMO_SEASON : null);
  const displayOwners = owners.length > 0 ? owners : (useDemoData ? DEMO_OWNERS : []);
  const displayPlayers = players.length > 0 ? players : (useDemoData ? DEMO_PLAYERS : []);
  const displayPicks = picks;
  const displayAvailable = availablePlayers.length > 0 || picks.length > 0
    ? availablePlayers
    : (useDemoData ? DEMO_PLAYERS : []);

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted">Loading draft...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && !displaySeason) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold text-red-400">{error}</p>
          <p className="text-sm text-muted">Check the URL and try again.</p>
        </div>
      </div>
    );
  }

  if (!displaySeason) return null;

  // ---- Pre-draft lobby ----
  if (displaySeason.draft_status !== "drafting" && displaySeason.draft_status !== "complete") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-2xl font-black tracking-tight">
            {displaySeason.year} Draft
          </h1>
          <div className="card p-6 space-y-3">
            <div className="text-sm font-semibold text-muted uppercase tracking-wider">
              {displaySeason.draft_status === "pending" && "Draft Not Started"}
              {displaySeason.draft_status === "keepers_open" && "Keeper Selection Open"}
              {displaySeason.draft_status === "keepers_locked" && "Keepers Locked — Waiting for Draft"}
            </div>
            <p className="text-sm text-muted">
              {displaySeason.draft_status === "pending"
                ? "The commissioner hasn't opened the draft yet."
                : displaySeason.draft_status === "keepers_open"
                  ? "Owners are still selecting keepers. The draft will begin once keepers are locked."
                  : "Keepers are locked. The commissioner will start the draft soon."}
            </p>
            {authOwner?.is_commissioner && (displaySeason.draft_status === "keepers_locked" || displaySeason.draft_status === "pending") && (
              <button
                className="btn-primary text-sm mt-4"
                onClick={async () => {
                  const res = await fetch("/api/draft/initialize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ season_id: displaySeason.id }),
                  });
                  if (res.ok) {
                    // Real-time will update the status, but also force a refresh
                    window.location.reload();
                  }
                }}
              >
                Initialize Draft
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Recompute display-level derived values using display data
  const displayOwnerMap = owners.length > 0 ? ownerMap : new Map(displayOwners.map((o) => [o.id, o]));
  const displayPlayerMap = players.length > 0 ? playerMap : new Map(displayPlayers.map((p) => [p.id, p]));
  const displayCurrentPick = currentPick ?? null;
  const displayNextPick = nextPick ?? null;
  const displayIsMyTurn = season ? canPickNow : false;

  // Splash details resolve at render time so the realtime handler doesn't
  // close over stale player/owner maps. A pick whose player we can't resolve
  // (roster fetch raced the realtime event) just skips the celebration.
  const splashPlayer = splashPick?.player_id
    ? displayPlayerMap.get(splashPick.player_id) ?? null
    : null;
  const splashRank =
    splashPlayer?.espn_id != null ? ranks[splashPlayer.espn_id]?.rank : undefined;
  // A full round of value below the slot earns the stamp. Rank-vs-pick is too
  // pessimistic here to call reaches (keepers skew elite and off-board), but
  // in this direction the keeper bias only makes a steal harder to earn.
  const splashIsSteal =
    !!splashPick &&
    !!splashRank &&
    splashRank > 0 &&
    splashPick.overall_pick - splashRank >= LEAGUE_CONFIG.NUM_TEAMS;

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              {displaySeason.year} Draft
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {displaySeason.draft_status === "drafting" && (
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                    Live
                  </span>
                </div>
              )}
              {displaySeason.draft_status === "complete" && (
                <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Complete
                </span>
              )}
              <span className="text-xs text-muted">
                Pick {currentPickNumber} of{" "}
                {LEAGUE_CONFIG.NUM_TEAMS * LEAGUE_CONFIG.NUM_ROUNDS}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pickError && (
            <span className="text-xs text-red-400 mr-2">{pickError}</span>
          )}
          {pendingTrades.length > 0 && (
            <button
              onClick={() => setShowTradeModal(true)}
              className="trade-notification btn-danger text-xs px-3 py-1.5"
            >
              {pendingTrades.length} Trade
              {pendingTrades.length > 1 ? "s" : ""} Pending
            </button>
          )}
          <button
            onClick={() => setShowTradeModal(true)}
            className="btn-secondary text-xs"
          >
            Propose Trade
          </button>
        </div>
      </div>

      {/* Draft Controls */}
      <DraftControls
        currentPick={displayCurrentPick}
        isMyTurn={displayIsMyTurn}
        ownerMap={displayOwnerMap}
        timerSeconds={displaySeason.pick_timer_seconds}
        seasonId={season?.id}
        canControlClock={isCommissioner}
        onNextPick={displayNextPick}
        undoTarget={season ? undoTarget : null}
        onUndo={undoLastPick}
      />

      {/* Main layout. The board sits beside the pool; the rosters view takes
          the full width — 12 columns of names need every pixel — and drops the
          pool below it so drafting is still one scroll away. */}
      {/* minmax(0,1fr) lets the board column shrink so all 12 teams fit. */}
      <div
        className={
          boardView === "board"
            ? "flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_340px] gap-3"
            : "space-y-3"
        }
      >
        {/* Below xl the pool comes first. The board is 15 rounds tall, so
            leaving it above the pool put the only way to draft a full screen
            or two down the page on a phone. */}
        <div className="min-w-0 order-2 xl:order-1">
          <DraftBoard
            picks={displayPicks}
            owners={displayOwners}
            playerMap={displayPlayerMap}
            currentPickNumber={currentPickNumber}
            recentPickId={recentPickId}
            currentOwnerId={currentOwnerId}
            view={boardView}
            onViewChange={setBoardView}
            ranks={ranks}
            isDraftComplete={displaySeason.draft_status === "complete"}
          />
        </div>

        {/* Player pool + ticker — sidebar on the board, a row under the rosters */}
        <div
          className={`order-1 xl:order-2 ${
            boardView === "board"
              ? "space-y-4"
              : "grid grid-cols-1 xl:grid-cols-2 gap-3"
          }`}
        >
          <PlayerPool
            players={displayAvailable}
            isMyTurn={displayIsMyTurn}
            onPick={makePick}
            requirements={myRequirements}
            ranks={ranks}
            pickingFor={pickingForName}
          />
          <LiveTicker
            picks={displayPicks}
            ownerMap={displayOwnerMap}
            playerMap={displayPlayerMap}
          />
        </div>
      </div>

      {/* Pick celebration splash. Keyed per announcement: CSS animations only
          run once per DOM node and the fade-out pins opacity at 0 with
          `forwards`, so back-to-back picks (buzzer pick, then an instant
          auto-pick) rendering into a reused node showed nothing. A fresh key
          remounts, restarting the animations and the dismiss timer. */}
      {splashPick && splashPlayer && (
        <PickSplash
          key={`${splashPick.id}:${splashPick.player_id}`}
          pick={splashPick}
          player={splashPlayer}
          teamName={
            displayOwnerMap.get(splashPick.current_owner_id)?.team_name ??
            "Unknown Team"
          }
          isSteal={splashIsSteal}
          // League lore: Marcus gets the clown treatment instead of pyro.
          roast={/marcus/i.test(
            displayOwnerMap.get(splashPick.current_owner_id)?.name ?? ""
          )}
          onDone={clearSplash}
        />
      )}

      {/* Trade Modal */}
      {showTradeModal && (
        <TradeModal
          owners={displayOwners}
          currentOwnerId={currentOwnerId}
          picks={displayPicks}
          seasonId={displaySeason.id}
          onClose={() => setShowTradeModal(false)}
        />
      )}
    </div>
  );
}
