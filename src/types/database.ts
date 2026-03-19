// Fantasy Football League Manager — Database Types

export interface Owner {
  id: string;
  name: string;
  email: string | null;
  team_name: string;
  avatar_url: string | null;
  joined_year: number;
  is_active: boolean;
  is_commissioner: boolean;
  created_at: string;
}

export interface Season {
  id: number;
  year: number;
  draft_status: 'pending' | 'keepers_open' | 'keepers_locked' | 'drafting' | 'complete';
  draft_order: string[]; // owner UUIDs
  pick_timer_seconds: number;
  current_pick_number: number | null;
  draft_started_at: string | null;
  trade_deadline: string | null;
  is_current: boolean;
  created_at: string;
}

export interface SeasonResult {
  id: number;
  season_id: number;
  owner_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  playoff_seed: number | null;
  playoff_result: 'champion' | 'runner_up' | 'third' | 'eliminated_rd2' | 'eliminated_rd1' | null;
  regular_season_finish: number | null;
  created_at: string;
}

export interface Player {
  id: number;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';
  nfl_team: string | null;
  espn_id: string | null;
  bye_week: number | null;
  is_active: boolean;
  created_at: string;
}

export interface DraftPick {
  id: number;
  season_id: number;
  round: number;
  pick_in_round: number;
  overall_pick: number;
  original_owner_id: string;
  current_owner_id: string;
  player_id: number | null;
  is_keeper: boolean;
  keeper_year: number | null; // 1-4
  picked_at: string | null;
  is_auto_pick: boolean;
  created_at: string;
}

export interface Keeper {
  id: number;
  season_id: number;
  owner_id: string;
  player_id: number;
  keeper_year: number; // 1-4 (K1-K4)
  round_cost: number;
  original_draft_round: number | null;
  source_type: 'draft' | 'free_agent' | 'trade';
  elected_at: string;
}

export interface Trade {
  id: number;
  season_id: number;
  proposer_id: string;
  accepter_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'voided';
  context: 'draft' | 'in_season' | 'offseason';
  proposed_at: string;
  resolved_at: string | null;
  notes: string | null;
  conditions_description: string | null;
}

export interface TradeAsset {
  id: number;
  trade_id: number;
  from_owner_id: string;
  to_owner_id: string;
  asset_type: 'draft_pick' | 'player' | 'future_pick';
  draft_pick_id: number | null;
  player_id: number | null;
  future_season_year: number | null;
  future_round: number | null;
  description: string | null;
  created_at: string;
}

export interface TradeCondition {
  id: number;
  trade_id: number;
  description: string;
  is_met: boolean;
  evaluated_at: string | null;
  outcome_description: string | null;
  created_at: string;
}

export interface Roster {
  id: number;
  season_id: number;
  owner_id: string;
  player_id: number;
  roster_slot: string;
  acquisition_type: 'draft' | 'trade' | 'free_agent' | 'waiver';
  created_at: string;
}

export interface AutoDraftSettings {
  id: number;
  season_id: number;
  owner_id: string;
  is_enabled: boolean;
  position_rules: PositionRule[];
  created_at: string;
}

export interface PositionRule {
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';
  min?: number;
  max?: number;
  by_round?: number;       // must have at least `min` of this position by this round
  not_before_round?: number; // don't draft this position before this round
}

export interface AutoDraftRanking {
  id: number;
  season_id: number;
  owner_id: string;
  player_id: number;
  rank: number;
  created_at: string;
}

export interface LeagueSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

// Roster slot configuration
export const ROSTER_SLOTS = {
  QB: { count: 1, label: 'Quarterback', eligible: ['QB'] },
  RB1: { count: 1, label: 'Running Back', eligible: ['RB'] },
  RB2: { count: 1, label: 'Running Back', eligible: ['RB'] },
  WR1: { count: 1, label: 'Wide Receiver', eligible: ['WR'] },
  WR2: { count: 1, label: 'Wide Receiver', eligible: ['WR'] },
  TE: { count: 1, label: 'Tight End', eligible: ['TE'] },
  FLEX: { count: 1, label: 'Flex (RB/WR/TE)', eligible: ['RB', 'WR', 'TE'] },
  SF: { count: 1, label: 'Superflex (QB/RB/WR/TE)', eligible: ['QB', 'RB', 'WR', 'TE'] },
  DEF: { count: 1, label: 'Defense', eligible: ['DEF'] },
  BN1: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  BN2: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  BN3: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  BN4: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  BN5: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  BN6: { count: 1, label: 'Bench', eligible: ['QB', 'RB', 'WR', 'TE', 'DEF'] },
  IR1: { count: 1, label: 'Injured Reserve', eligible: ['QB', 'RB', 'WR', 'TE'] },
  IR2: { count: 1, label: 'Injured Reserve', eligible: ['QB', 'RB', 'WR', 'TE'] },
} as const;

export type RosterSlot = keyof typeof ROSTER_SLOTS;

// Required positions that MUST be drafted (can't skip)
export const REQUIRED_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'] as const;

// League constants
export const LEAGUE_CONFIG = {
  NUM_TEAMS: 12,
  NUM_ROUNDS: 15,
  MAX_KEEPERS: 5,
  KEEPER_MAX_YEARS: 5, // includes draft year
  FREE_AGENT_KEEPER_ROUND: 10,
  DRAFT_TYPE: 'snake' as const,
} as const;

// Enriched types for UI (with joined data)
export interface DraftPickWithDetails extends DraftPick {
  player?: Player;
  original_owner?: Owner;
  current_owner?: Owner;
}

export interface TradeWithDetails extends Trade {
  proposer?: Owner;
  accepter?: Owner;
  assets?: TradeAssetWithDetails[];
  conditions?: TradeCondition[];
}

export interface TradeAssetWithDetails extends TradeAsset {
  player?: Player;
  draft_pick?: DraftPick;
  from_owner?: Owner;
  to_owner?: Owner;
}

export interface KeeperWithDetails extends Keeper {
  player?: Player;
  owner?: Owner;
}

export interface OwnerWithStats extends Owner {
  total_wins?: number;
  total_losses?: number;
  total_ties?: number;
  championships?: number;
  seasons_played?: number;
  total_points_for?: number;
}
