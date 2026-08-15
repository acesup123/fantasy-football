/**
 * Populate the draftable player pool from ESPN.
 *
 * The draft board queries `players WHERE is_active = true`. Every row was
 * is_active = false, so the pool rendered empty and nothing could be drafted.
 *
 * This marks the players ESPN currently lists as fantasy-relevant active, fills
 * in nfl_team and bye_week (both were null league-wide), and inserts anyone
 * draftable who isn't in the table yet.
 *
 * Usage:
 *   npx tsx scripts/populate-player-pool.ts            # dry run
 *   npx tsx scripts/populate-player-pool.ts --apply
 *   npx tsx scripts/populate-player-pool.ts --apply --season 2026
 */

import { createClient } from '@supabase/supabase-js';
import { PRO_TEAM_ABBREV, playerGroupKey, type LeaguePosition } from '../src/lib/espn/players';
import { getLeagueId } from '../src/lib/espn/request';

const APPLY = process.argv.includes('--apply');
const seasonArg = process.argv.indexOf('--season');
const SEASON = seasonArg !== -1 ? parseInt(process.argv[seasonArg + 1]) : 2026;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Only positions this league rosters. Kickers and IDP are ignored. */
const POSITION_BY_ID: Record<number, LeaguePosition> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 16: 'DEF',
};

function cookie() {
  return `SWID=${process.env.ESPN_SWID ?? ''}; espn_s2=${process.env.ESPN_S2 ?? ''}`;
}

/** Fantasy-relevant players with their draft ranks. */
async function fetchRankedPool(year: number) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${getLeagueId()}?view=kona_player_info`;
  const resp = await fetch(url, {
    headers: {
      Cookie: cookie(),
      'x-fantasy-filter': JSON.stringify({
        players: {
          limit: 2000,
          sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'STANDARD' },
        },
      }),
    },
  });
  if (!resp.ok) throw new Error(`ESPN kona_player_info ${resp.status}`);
  const data = await resp.json();
  return (data.players ?? []) as any[];
}

/** proTeamId → bye week for the season. */
async function fetchByeWeeks(year: number): Promise<Map<number, number>> {
  const resp = await fetch(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}?view=proTeamSchedules_wl`,
    { headers: { Cookie: cookie() } }
  );
  if (!resp.ok) return new Map();
  const data = await resp.json();
  const byes = new Map<number, number>();
  for (const t of data.settings?.proTeams ?? []) {
    if (typeof t.id === 'number' && typeof t.byeWeek === 'number' && t.byeWeek > 0) {
      byes.set(t.id, t.byeWeek);
    }
  }
  return byes;
}

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  console.log(APPLY ? `⚠️  APPLY MODE — season ${SEASON}\n` : `🔍 DRY RUN — season ${SEASON}\n`);

  const [pool, byeWeeks] = await Promise.all([fetchRankedPool(SEASON), fetchByeWeeks(SEASON)]);
  console.log(`ESPN: ${pool.length} fantasy-relevant players, ${byeWeeks.size} teams with bye weeks`);

  const draftable = pool
    .map(entry => {
      const p = entry.player ?? {};
      const position = POSITION_BY_ID[p.defaultPositionId];
      if (!position) return null;
      return {
        espnId: String(entry.id ?? p.id),
        name: p.fullName as string,
        position,
        nflTeam: PRO_TEAM_ABBREV[p.proTeamId] ?? null,
        byeWeek: byeWeeks.get(p.proTeamId) ?? null,
      };
    })
    .filter(Boolean) as {
      espnId: string; name: string; position: LeaguePosition;
      nflTeam: string | null; byeWeek: number | null;
    }[];

  console.log(`draftable at league positions (QB/RB/WR/TE/DEF): ${draftable.length}`);

  const existing = await fetchAll<{
    id: number; name: string; position: string; espn_id: string | null; is_active: boolean;
  }>('players', 'id, name, position, espn_id, is_active');
  const byEspnId = new Map(existing.filter(p => p.espn_id).map(p => [p.espn_id!, p]));

  // A player already in the table but without an espn_id must be matched by
  // name, or we'd insert a second row and recreate the duplicates just cleaned up.
  const byName = new Map<string, typeof existing[number]>();
  for (const p of existing) {
    if (p.espn_id) continue;
    byName.set(playerGroupKey(p.name, p.position), p);
  }

  const toUpdate: { d: typeof draftable[number]; rowId: number; adoptEspnId: boolean }[] = [];
  const toInsert: typeof draftable = [];
  for (const d of draftable) {
    const byId = byEspnId.get(d.espnId);
    if (byId) { toUpdate.push({ d, rowId: byId.id, adoptEspnId: false }); continue; }
    const byNm = byName.get(playerGroupKey(d.name, d.position));
    if (byNm) { toUpdate.push({ d, rowId: byNm.id, adoptEspnId: true }); byName.delete(playerGroupKey(d.name, d.position)); continue; }
    toInsert.push(d);
  }
  const adopted = toUpdate.filter(u => u.adoptEspnId).length;
  const activeEspnIds = new Set(draftable.map(d => d.espnId));
  const keepIds = new Set(toUpdate.map(u => u.rowId));
  const toDeactivate = existing.filter(p => p.is_active && !keepIds.has(p.id));
  void activeEspnIds;

  console.log(`\n  activate + fill team/bye : ${toUpdate.length} (${adopted} matched by name, adopting espn_id)`);
  console.log(`  insert (missing entirely): ${toInsert.length}`);
  console.log(`  deactivate (not in pool) : ${toDeactivate.length}`);
  if (toInsert.length > 0) {
    console.log('  sample inserts:', toInsert.slice(0, 6).map(p => `${p.name} (${p.position})`).join(', '));
  }

  if (!APPLY) {
    console.log('\n🔍 Dry run complete. Re-run with --apply.');
    return;
  }

  // Everyone starts inactive; only this season's pool is turned back on.
  await supabase.from('players').update({ is_active: false }).neq('id', -1);

  let updated = 0;
  for (const { d, rowId, adoptEspnId } of toUpdate) {
    const { error } = await supabase
      .from('players')
      .update({
        is_active: true,
        nfl_team: d.nflTeam,
        bye_week: d.byeWeek,
        position: d.position,
        ...(adoptEspnId ? { espn_id: d.espnId, name: d.name } : {}),
      })
      .eq('id', rowId);
    if (!error) updated++;
  }
  console.log(`  ✅ ${updated} activated`);

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200).map(d => ({
      name: d.name,
      position: d.position,
      nfl_team: d.nflTeam,
      bye_week: d.byeWeek,
      espn_id: d.espnId,
      is_active: true,
    }));
    const { data, error } = await supabase.from('players').insert(batch).select('id');
    if (error) console.log(`  ⚠️  insert batch failed: ${error.message}`);
    else inserted += data?.length ?? 0;
  }
  console.log(`  ✅ ${inserted} inserted`);

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);
  console.log(`\n✅ draftable pool is now ${count} players`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
