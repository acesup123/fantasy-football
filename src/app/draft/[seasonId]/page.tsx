"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { DraftBoard } from "./components/draft-board";
import { PlayerPool } from "./components/player-pool";
import { DraftControls } from "./components/draft-controls";
import { TradeModal } from "./components/trade-modal";
import { LiveTicker } from "./components/live-ticker";
import type { DraftPick, Player, Owner, Season, Trade } from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { subscribeToDraft } from "@/lib/draft/subscriptions";
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
  const [recentPickId, setRecentPickId] = useState<number | undefined>(undefined);
  const [pickError, setPickError] = useState<string | null>(null);

  const subscriptionsRef = useRef<{ unsubscribeAll: () => void } | null>(null);

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
  }, [season?.id, supabase]);

  // ---- Derived state ----
  const currentOwnerId = authOwner?.id ?? "";

  const currentPickNumber = season?.current_pick_number ?? 1;
  const currentPick = picks.find((p) => p.overall_pick === currentPickNumber);
  const nextPick = picks.find((p) => p.overall_pick === currentPickNumber + 1);
  const isMyTurn = currentPick?.current_owner_id === currentOwnerId;

  const draftedPlayerIds = useMemo(
    () => new Set(picks.filter((p) => p.player_id !== null).map((p) => p.player_id)),
    [picks]
  );
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

  // ---- Make a pick (POST to API) ----
  const makePick = useCallback(
    async (playerId: number) => {
      if (!isMyTurn || !currentPick || !season) return;
      setPickError(null);

      try {
        const res = await fetch("/api/draft/pick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season_id: season.id,
            overall_pick: currentPickNumber,
            player_id: playerId,
            owner_id: currentOwnerId,
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
        setSeason((prev) =>
          prev ? { ...prev, current_pick_number: currentPickNumber + 1 } : prev
        );
        setTimeout(() => setRecentPickId(undefined), 2000);
      } catch {
        setPickError("Network error — try again");
      }
    },
    [isMyTurn, currentPick, season, currentPickNumber, currentOwnerId]
  );

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
  const displayIsMyTurn = season ? isMyTurn : false;

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
        onNextPick={displayNextPick}
      />

      {/* Main Layout: Board + Sidebar (Player Pool + Ticker) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <DraftBoard
          picks={displayPicks}
          owners={displayOwners}
          playerMap={displayPlayerMap}
          currentPickNumber={currentPickNumber}
          recentPickId={recentPickId}
        />

        {/* Sidebar */}
        <div className="space-y-4">
          <PlayerPool
            players={displayAvailable}
            isMyTurn={displayIsMyTurn}
            onPick={makePick}
          />
          <LiveTicker
            picks={displayPicks}
            ownerMap={displayOwnerMap}
            playerMap={displayPlayerMap}
          />
        </div>
      </div>

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
