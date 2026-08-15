-- ============================================================
-- 003: Divisions
-- ============================================================
--
-- The league runs two 6-team divisions with H2H_RECORD playoff seeding, which
-- is why playoffSeed cannot be re-derived by sorting on wins and points —
-- division winners take priority. ESPN exposes the division layout in
-- settings.scheduleSettings.divisions and the assignment as team.divisionId.
--
-- The in-division record is a separate bucket (team.record.division). Note ESPN
-- does NOT track points in that bucket — pointsFor/pointsAgainst are always 0
-- there — so only W/L/T are stored.

ALTER TABLE season_results
  ADD COLUMN IF NOT EXISTS division_id     INT,
  ADD COLUMN IF NOT EXISTS division_name   TEXT,
  ADD COLUMN IF NOT EXISTS division_wins   INT,
  ADD COLUMN IF NOT EXISTS division_losses INT,
  ADD COLUMN IF NOT EXISTS division_ties   INT;

COMMENT ON COLUMN season_results.division_id IS
  'ESPN team.divisionId. Divisions are per-season; a team can move between them.';
COMMENT ON COLUMN season_results.division_wins IS
  'Wins within division (ESPN team.record.division). Points are not tracked in that bucket.';

-- Standings groups a season by division
CREATE INDEX IF NOT EXISTS season_results_season_division_idx
  ON season_results (season_id, division_id);
