-- ============================================================
-- 004: Per-owner UI preferences
-- ============================================================
--
-- Theme lives in its own table rather than a column on `owners` on purpose.
-- `owners` has no UPDATE policy today — it is read-only to the league — and
-- adding one would let an owner write every column of their own row,
-- is_commissioner included. RLS is row-level, not column-level, so there is no
-- way to open up one column and keep the rest closed. A separate table keeps
-- the writable surface to exactly what a user is allowed to change.

CREATE TABLE IF NOT EXISTS owner_preferences (
  owner_id   UUID PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  theme      TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE owner_preferences IS
  'Per-owner UI settings. Separate from `owners` so RLS can grant self-writes without exposing is_commissioner.';
COMMENT ON COLUMN owner_preferences.theme IS
  '"system" follows the OS setting via prefers-color-scheme. Default "dark" — the league has only ever seen the dark palette.';

ALTER TABLE owner_preferences ENABLE ROW LEVEL SECURITY;

-- Preferences are private: an owner sees and writes only their own row.
-- (Every other table in this schema is league-readable; this one is not.)
CREATE POLICY "Owners read own preferences" ON owner_preferences
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

CREATE POLICY "Owners write own preferences" ON owner_preferences
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));

CREATE POLICY "Owners update own preferences" ON owner_preferences
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'))
  WITH CHECK (owner_id = (SELECT id FROM owners WHERE email = auth.jwt()->>'email'));
