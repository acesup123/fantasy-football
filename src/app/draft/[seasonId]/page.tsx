"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { DraftBoard } from "./components/draft-board";
import { PlayerPool } from "./components/player-pool";
import { DraftControls } from "./components/draft-controls";
import { TradeModal } from "./components/trade-modal";
import { LiveTicker } from "./components/live-ticker";
import type { DraftPick, Player, Owner, Season, Trade } from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";
import { generateSnakeOrder } from "@/lib/draft/snake-order";

// ============================================================
// DEMO DATA — makes the board look alive before Supabase
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
  current_pick_number: 13, // Start at round 2 so round 1 shows filled
  draft_started_at: new Date().toISOString(),
  trade_deadline: null,
  is_current: true,
  created_at: new Date().toISOString(),
};

// Pre-fill round 1 with picks to show how the board looks
function generateRound1Picks(draftSlots: ReturnType<typeof generateSnakeOrder>): DraftPick[] {
  const round1Players = [
    20, 40, 21, 1, 43, 24, 2, 22, 41, 42, 23, 44 // CMC, Chase, Bijan, Mahomes, JJ, Saquon, Allen, Breece, Tyreek, CeeDee, Henry, Amon-Ra
  ];

  return draftSlots.map((slot) => {
    const isRound1 = slot.round === 1;
    const playerId = isRound1 ? round1Players[slot.pickInRound - 1] : null;

    return {
      id: slot.overallPick,
      season_id: 1,
      round: slot.round,
      pick_in_round: slot.pickInRound,
      overall_pick: slot.overallPick,
      original_owner_id: slot.ownerId,
      current_owner_id: slot.ownerId,
      player_id: playerId ?? null,
      is_keeper: isRound1 && [0, 3, 5].includes(slot.pickInRound - 1), // Some keepers
      keeper_year: isRound1 && slot.pickInRound === 1 ? 3 : isRound1 && slot.pickInRound === 4 ? 1 : isRound1 && slot.pickInRound === 6 ? 2 : null,
      picked_at: isRound1 ? new Date().toISOString() : null,
      is_auto_pick: false,
      created_at: new Date().toISOString(),
    };
  });
}

export default function DraftPage() {
  const [season, setSeason] = useState<Season>(DEMO_SEASON);
  const [owners] = useState<Owner[]>(DEMO_OWNERS);
  const [players] = useState<Player[]>(DEMO_PLAYERS);
  const [currentOwnerId] = useState<string>("owner-1"); // Will come from auth
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [pendingTrades] = useState<Trade[]>([]);
  const [recentPickId, setRecentPickId] = useState<number | undefined>(undefined);

  // Generate draft slots
  const draftSlots = useMemo(
    () => generateSnakeOrder(season.draft_order),
    [season.draft_order]
  );

  // Initialize picks with round 1 pre-filled
  const [picks, setPicks] = useState<DraftPick[]>(() =>
    generateRound1Picks(draftSlots)
  );

  // Current pick info
  const currentPickNumber = season.current_pick_number ?? 1;
  const currentPick = picks.find((p) => p.overall_pick === currentPickNumber);
  const nextPick = picks.find((p) => p.overall_pick === currentPickNumber + 1);
  const isMyTurn = currentPick?.current_owner_id === currentOwnerId;

  // Make a pick
  const makePick = useCallback(
    (playerId: number) => {
      if (!isMyTurn || !currentPick) return;

      setRecentPickId(currentPick.id);

      setPicks((prev) =>
        prev.map((p) =>
          p.overall_pick === currentPickNumber
            ? {
                ...p,
                player_id: playerId,
                picked_at: new Date().toISOString(),
              }
            : p
        )
      );

      setSeason((prev) => ({
        ...prev,
        current_pick_number: currentPickNumber + 1,
      }));

      // Clear recent pick animation after delay
      setTimeout(() => setRecentPickId(undefined), 2000);
    },
    [isMyTurn, currentPick, currentPickNumber]
  );

  // Available players
  const draftedPlayerIds = new Set(
    picks.filter((p) => p.player_id !== null).map((p) => p.player_id)
  );
  const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));

  // Lookups
  const ownerMap = useMemo(
    () => new Map(owners.map((o) => [o.id, o])),
    [owners]
  );
  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players]
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              {season.year} Draft
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                  Live
                </span>
              </div>
              <span className="text-xs text-muted">
                Pick {currentPickNumber} of{" "}
                {LEAGUE_CONFIG.NUM_TEAMS * LEAGUE_CONFIG.NUM_ROUNDS}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
        currentPick={currentPick ?? null}
        isMyTurn={isMyTurn}
        ownerMap={ownerMap}
        timerSeconds={season.pick_timer_seconds}
        onNextPick={nextPick ?? null}
      />

      {/* Main Layout: Board + Sidebar (Player Pool + Ticker) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <DraftBoard
          picks={picks}
          owners={owners}
          playerMap={playerMap}
          currentPickNumber={currentPickNumber}
          recentPickId={recentPickId}
        />

        {/* Sidebar */}
        <div className="space-y-4">
          <PlayerPool
            players={availablePlayers}
            isMyTurn={isMyTurn}
            onPick={makePick}
          />
          <LiveTicker
            picks={picks}
            ownerMap={ownerMap}
            playerMap={playerMap}
          />
        </div>
      </div>

      {/* Trade Modal */}
      {showTradeModal && (
        <TradeModal
          owners={owners}
          currentOwnerId={currentOwnerId}
          picks={picks}
          seasonId={season.id}
          onClose={() => setShowTradeModal(false)}
        />
      )}
    </div>
  );
}
