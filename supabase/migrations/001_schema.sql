-- Fantasy Football League Manager Schema
-- 12-team superflex keeper league

-- ============================================================
-- OWNERS
-- ============================================================
CREATE TABLE owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  team_name TEXT NOT NULL,
  avatar_url TEXT,
  joined_year INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_commissioner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SEASONS
-- ============================================================
CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  year INT NOT NULL UNIQUE,
  draft_status TEXT DEFAULT 'pending'
    CHECK (draft_status IN ('pending', 'keepers_open', 'keepers_locked', 'drafting', 'complete')),
  draft_order UUID[] NOT NULL DEFAULT '{}',
  pick_timer_seconds INT DEFAULT 120,
  current_pick_number INT,
  draft_started_at TIMESTAMPTZ,
  trade_deadline DATE,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SEASON RESULTS
-- ============================================================
CREATE TABLE season_results (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id),
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  ties INT DEFAULT 0,
  points_for NUMERIC(10,2) DEFAULT 0,
  points_against NUMERIC(10,2) DEFAULT 0,
  playoff_seed INT,
  playoff_result TEXT
    CHECK (playoff_result IN ('champion', 'runner_up', 'third', 'eliminated_rd2', 'eliminated_rd1', NULL)),
  regular_season_finish INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, owner_id)
);

-- ============================================================
-- PLAYERS
-- ============================================================
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'DEF')),
  nfl_team TEXT,
  espn_id TEXT,
  bye_week INT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_players_position ON players(position);
CREATE INDEX idx_players_name ON players(name);
CREATE INDEX idx_players_espn_id ON players(espn_id);

-- ============================================================
-- DRAFT PICKS
-- ============================================================
CREATE TABLE draft_picks (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  round INT NOT NULL CHECK (round BETWEEN 1 AND 15),
  pick_in_round INT NOT NULL CHECK (pick_in_round BETWEEN 1 AND 12),
  overall_pick INT NOT NULL CHECK (overall_pick BETWEEN 1 AND 180),
  original_owner_id UUID REFERENCES owners(id),
  current_owner_id UUID REFERENCES owners(id),
  player_id INT REFERENCES players(id),
  is_keeper BOOLEAN DEFAULT false,
  keeper_year INT CHECK (keeper_year BETWEEN 1 AND 4),
  picked_at TIMESTAMPTZ,
  is_auto_pick BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, round, pick_in_round),
  UNIQUE(season_id, overall_pick)
);

CREATE INDEX idx_draft_picks_season ON draft_picks(season_id);
CREATE INDEX idx_draft_picks_player ON draft_picks(player_id);
CREATE INDEX idx_draft_picks_current_owner ON draft_picks(current_owner_id);
CREATE INDEX idx_draft_picks_original_owner ON draft_picks(original_owner_id);

-- ============================================================
-- KEEPERS
-- ============================================================
CREATE TABLE keepers (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id),
  player_id INT REFERENCES players(id),
  keeper_year INT NOT NULL CHECK (keeper_year BETWEEN 1 AND 4),
  round_cost INT NOT NULL CHECK (round_cost BETWEEN 1 AND 15),
  original_draft_round INT,
  source_type TEXT DEFAULT 'draft' CHECK (source_type IN ('draft', 'free_agent', 'trade')),
  elected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, owner_id, player_id)
);

CREATE INDEX idx_keepers_season ON keepers(season_id);
CREATE INDEX idx_keepers_owner ON keepers(owner_id);

-- ============================================================
-- TRADES (year-round: offseason, in-season, draft day)
-- ============================================================
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  proposer_id UUID REFERENCES owners(id),
  accepter_id UUID REFERENCES owners(id),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'voided')),
  context TEXT DEFAULT 'offseason'
    CHECK (context IN ('draft', 'in_season', 'offseason')),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  conditions_description TEXT
);

CREATE INDEX idx_trades_season ON trades(season_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_proposer ON trades(proposer_id);
CREATE INDEX idx_trades_accepter ON trades(accepter_id);

-- ============================================================
-- TRADE ASSETS
-- ============================================================
CREATE TABLE trade_assets (
  id SERIAL PRIMARY KEY,
  trade_id INT REFERENCES trades(id) ON DELETE CASCADE,
  from_owner_id UUID REFERENCES owners(id),
  to_owner_id UUID REFERENCES owners(id),
  asset_type TEXT NOT NULL
    CHECK (asset_type IN ('draft_pick', 'player', 'future_pick')),
  draft_pick_id INT REFERENCES draft_picks(id),
  player_id INT REFERENCES players(id),
  future_season_year INT,
  future_round INT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trade_assets_trade ON trade_assets(trade_id);

-- ============================================================
-- TRADE CONDITIONS
-- ============================================================
CREATE TABLE trade_conditions (
  id SERIAL PRIMARY KEY,
  trade_id INT REFERENCES trades(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_met BOOLEAN DEFAULT false,
  evaluated_at TIMESTAMPTZ,
  outcome_description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROSTERS (end-of-season snapshots)
-- ============================================================
CREATE TABLE rosters (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id),
  player_id INT REFERENCES players(id),
  roster_slot TEXT CHECK (roster_slot IN (
    'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SF', 'DEF',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6', 'IR1', 'IR2'
  )),
  acquisition_type TEXT CHECK (acquisition_type IN ('draft', 'trade', 'free_agent', 'waiver')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, owner_id, player_id)
);

-- ============================================================
-- AUTO-DRAFT SETTINGS (per owner per season)
-- ============================================================
CREATE TABLE auto_draft_settings (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id),
  is_enabled BOOLEAN DEFAULT false,
  position_rules JSONB DEFAULT '[]',
  -- position_rules example:
  -- [
  --   {"position": "RB", "min": 2, "by_round": 4},
  --   {"position": "TE", "min": 1, "by_round": 8},
  --   {"position": "QB", "max": 3},
  --   {"position": "DEF", "max": 1, "not_before_round": 12}
  -- ]
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, owner_id)
);

-- ============================================================
-- AUTO-DRAFT RANKINGS (custom player rankings per owner)
-- ============================================================
CREATE TABLE auto_draft_rankings (
  id SERIAL PRIMARY KEY,
  season_id INT REFERENCES seasons(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES owners(id),
  player_id INT REFERENCES players(id),
  rank INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(season_id, owner_id, player_id),
  UNIQUE(season_id, owner_id, rank)
);

-- ============================================================
-- LEAGUE SETTINGS
-- ============================================================
CREATE TABLE league_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed league settings
INSERT INTO league_settings (key, value) VALUES
  ('league_name', '"Fantasy Football League"'),
  ('num_teams', '12'),
  ('num_rounds', '15'),
  ('max_keepers', '5'),
  ('keeper_max_years', '5'),
  ('free_agent_keeper_round', '10'),
  ('roster_spots', '{
    "QB": 1, "RB": 2, "WR": 2, "TE": 1,
    "FLEX": 1, "SF": 1, "DEF": 1,
    "BN": 6, "IR": 2
  }'),
  ('scoring_format', '"half_ppr"'),
  ('draft_type', '"snake"');

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE draft_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE seasons;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE keepers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_draft_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_draft_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_settings ENABLE ROW LEVEL SECURITY;

-- Everyone in the league can read everything
CREATE POLICY "League members read all" ON owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON seasons FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON season_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON players FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON draft_picks FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON keepers FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON trades FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON trade_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON trade_conditions FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON rosters FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON auto_draft_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON auto_draft_rankings FOR SELECT TO authenticated USING (true);
CREATE POLICY "League members read all" ON league_settings FOR SELECT TO authenticated USING (true);

-- Owners manage their own keepers
CREATE POLICY "Owners manage own keepers" ON keepers
  FOR ALL TO authenticated
  USING (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'))
  WITH CHECK (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

-- Owners make their own picks
CREATE POLICY "Owners make own picks" ON draft_picks
  FOR UPDATE TO authenticated
  USING (current_owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

-- Trade policies
CREATE POLICY "Anyone can propose trades" ON trades
  FOR INSERT TO authenticated
  WITH CHECK (proposer_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

CREATE POLICY "Trade parties can update" ON trades
  FOR UPDATE TO authenticated
  USING (
    proposer_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email')
    OR accepter_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email')
  );

-- Trade assets follow trade permissions
CREATE POLICY "Trade parties manage assets" ON trade_assets
  FOR ALL TO authenticated
  USING (trade_id IN (
    SELECT id FROM trades WHERE
      proposer_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email')
      OR accepter_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email')
  ));

-- Auto-draft: owners manage their own
CREATE POLICY "Owners manage own auto-draft" ON auto_draft_settings
  FOR ALL TO authenticated
  USING (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'))
  WITH CHECK (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

CREATE POLICY "Owners manage own rankings" ON auto_draft_rankings
  FOR ALL TO authenticated
  USING (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'))
  WITH CHECK (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));
