-- ============================================================
-- 002: Final placement + richer standings fields
-- ============================================================
--
-- season_results already stores the regular season (wins/losses/points) and
-- `regular_season_finish`, which is fed from ESPN's team.playoffSeed. That is
-- correct: ESPN assigns playoff seeds strictly by regular-season standings order.
--
-- What was missing is where teams landed AFTER the playoffs. `playoff_result`
-- only ever gets 'champion' or 'runner_up', so placements 3-12 were unrecorded.
-- ESPN exposes this as team.rankCalculatedFinal.
--
-- This matters because the draft-order lottery seeds off final placement, not
-- regular-season order. In 2025 the two disagreed for three pairs of teams
-- (seeds 4/5, 7/8 and 11/12 each swapped), which silently produced the wrong
-- lottery odds.

ALTER TABLE season_results
  ADD COLUMN IF NOT EXISTS final_rank    INT,
  ADD COLUMN IF NOT EXISTS streak_length INT,
  ADD COLUMN IF NOT EXISTS streak_type   TEXT,
  ADD COLUMN IF NOT EXISTS games_back    NUMERIC(5,2);

-- Guard the streak enum separately so the ADD COLUMN stays idempotent
DO $$
BEGIN
  ALTER TABLE season_results
    ADD CONSTRAINT season_results_streak_type_check
    CHECK (streak_type IN ('WIN', 'LOSS', 'TIE') OR streak_type IS NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN season_results.final_rank IS
  'Final placement after playoffs (ESPN team.rankCalculatedFinal). 1-12. Distinct from regular_season_finish.';
COMMENT ON COLUMN season_results.regular_season_finish IS
  'Regular-season standings rank (ESPN team.playoffSeed). Distinct from final_rank.';

-- The lottery and standings pages both read a whole season ordered by placement
CREATE INDEX IF NOT EXISTS season_results_season_final_rank_idx
  ON season_results (season_id, final_rank);

-- Clean up bogus zero ranks written before the season starts.
-- ESPN returns 0 (not null) for every rank field pre-season, and the old sync
-- used `?? null`, which does not catch 0 — so the in-progress season's rows were
-- persisted with a rank of 0. A rank of 0 is not a real placement.
UPDATE season_results
   SET playoff_seed = NULL
 WHERE playoff_seed = 0;

UPDATE season_results
   SET regular_season_finish = NULL
 WHERE regular_season_finish = 0;
