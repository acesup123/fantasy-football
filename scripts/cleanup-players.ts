/**
 * Clean up the `players` table.
 *
 * Three problems, all artifacts of the historical spreadsheet imports:
 *
 *   1. Names carry a position prefix — "RB, Adrian Peterson" / "RB Adrian Peterson".
 *   2. The same player exists as several rows. Typically the row holding the
 *      draft history has no espn_id, while a later ESPN-sourced row
 *      ("Michael Pittman Jr.") has the espn_id and no history.
 *   3. Most rows have no espn_id at all, so ESPN data (keepers, rosters) can't
 *      be matched to them.
 *
 * Draft history itself is NOT touched — the uploaded draft orders are correct.
 * This only repairs the player rows that history points at.
 *
 * Usage:
 *   npx tsx scripts/cleanup-players.ts            # dry run — reports, writes nothing
 *   npx tsx scripts/cleanup-players.ts --apply    # execute
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { fetchPlayerIndex, playerGroupKey, stripPositionPrefix } from '../src/lib/espn/players';

const APPLY = process.argv.includes('--apply');
const POOL_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Tables holding a player_id foreign key, and the unique key that a merge
// could collide with (null = no collision risk, safe to repoint blindly).
const REFERENCING_TABLES: { table: string; conflictKey: string[] | null }[] = [
  { table: 'draft_picks', conflictKey: null },
  { table: 'keepers', conflictKey: ['season_id', 'owner_id'] },
  { table: 'rosters', conflictKey: ['season_id', 'owner_id'] },
  { table: 'matchup_lineups', conflictKey: null },
];

interface PlayerRow {
  id: number;
  name: string;
  position: string;
  nfl_team: string | null;
  espn_id: string | null;
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

/** player_id → number of rows referencing it, per table. */
async function countReferences(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const { table } of REFERENCING_TABLES) {
    let rows: { player_id: number }[] = [];
    try {
      rows = await fetchAll<{ player_id: number }>(table, 'player_id');
    } catch {
      console.log(`  (skipping ${table} — not readable)`);
      continue;
    }
    for (const r of rows) {
      if (r.player_id != null) counts.set(r.player_id, (counts.get(r.player_id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Build normalized "name|position" → espnId from ESPN's season player pools.
 * Names that map to more than one ESPN id are dropped as ambiguous rather than
 * guessed at.
 */
async function buildEspnNameIndex(): Promise<{
  index: Map<string, { espnId: number; name: string; nflTeam: string | null }>;
  ambiguous: Set<string>;
}> {
  const index = new Map<string, { espnId: number; name: string; nflTeam: string | null }>();
  const seenIds = new Map<string, Set<number>>();

  // Newest season first so a player's most recent name/team wins.
  for (const year of POOL_YEARS) {
    let pool;
    try {
      pool = await fetchPlayerIndex(year);
    } catch (err: any) {
      console.log(`  (ESPN pool ${year} unavailable: ${err.message})`);
      continue;
    }
    for (const info of pool.values()) {
      if (!info.position) continue;
      const key = playerGroupKey(info.name, info.position);
      if (!seenIds.has(key)) seenIds.set(key, new Set());
      seenIds.get(key)!.add(info.espnId);
      if (!index.has(key)) {
        index.set(key, { espnId: info.espnId, name: info.name, nflTeam: info.nflTeam });
      }
    }
    console.log(`  ESPN ${year}: ${pool.size} players`);
  }

  const ambiguous = new Set<string>();
  for (const [key, ids] of seenIds) {
    // Defenses key on the team itself, which is unambiguous by construction —
    // ESPN just lists a team's D/ST under several spellings and ids.
    if (key.startsWith('def|')) continue;
    if (ids.size > 1) ambiguous.add(key);
  }
  return { index, ambiguous };
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — changes will be written\n' : '🔍 DRY RUN — nothing will be written\n');

  console.log('Loading Supabase players and reference counts...');
  const players = await fetchAll<PlayerRow>('players', 'id, name, position, nfl_team, espn_id');
  const refCounts = await countReferences();
  console.log(`  ${players.length} players, ${[...refCounts.values()].reduce((a, b) => a + b, 0)} references\n`);

  console.log('Building ESPN name index...');
  const { index: espnIndex, ambiguous } = await buildEspnNameIndex();
  console.log(`  ${espnIndex.size} distinct ESPN name keys (${ambiguous.size} ambiguous, will be skipped)\n`);

  // ---------------------------------------------------------------
  // Plan: group duplicates by normalized name + position
  // ---------------------------------------------------------------
  const groups = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const key = playerGroupKey(p.name, p.position);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const merges: { survivor: PlayerRow; losers: PlayerRow[]; key: string }[] = [];
  const renames: { player: PlayerRow; newName: string }[] = [];
  const backfills: { player: PlayerRow; espnId: number }[] = [];
  const needsReview: { key: string; rows: PlayerRow[] }[] = [];

  for (const [key, rows] of groups) {
    // ESPN lists more than one distinct player under this name+position, so
    // these rows may be different people. Never merge on a guess — report it.
    if (rows.length > 1 && ambiguous.has(key)) {
      needsReview.push({ key, rows });
      continue;
    }

    // Survivor = most references (the row carrying the history), then one with
    // an espn_id, then lowest id for determinism.
    const ranked = [...rows].sort((a, b) => {
      const ra = refCounts.get(a.id) ?? 0;
      const rb = refCounts.get(b.id) ?? 0;
      if (ra !== rb) return rb - ra;
      if (Boolean(a.espn_id) !== Boolean(b.espn_id)) return a.espn_id ? -1 : 1;
      return a.id - b.id;
    });
    const survivor = ranked[0];
    const losers = ranked.slice(1);
    if (losers.length > 0) merges.push({ survivor, losers, key });

    // The espn_id may live on a loser row — carry it over.
    const inheritedEspnId = survivor.espn_id ?? losers.find(l => l.espn_id)?.espn_id ?? null;
    const espnMatch = ambiguous.has(key) ? undefined : espnIndex.get(key);

    if (!inheritedEspnId && espnMatch) {
      backfills.push({ player: survivor, espnId: espnMatch.espnId });
    } else if (!survivor.espn_id && inheritedEspnId) {
      backfills.push({ player: survivor, espnId: Number(inheritedEspnId) });
    }

    // Prefer ESPN's spelling ("Michael Pittman Jr."), else strip the prefix.
    const desired = espnMatch?.name ?? stripPositionPrefix(survivor.name);
    if (desired && desired !== survivor.name) {
      renames.push({ player: survivor, newName: desired });
    }
  }

  // ---------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------
  console.log('='.repeat(78));
  console.log(`MERGE DUPLICATE ROWS: ${merges.length} groups, ${merges.reduce((a, m) => a + m.losers.length, 0)} rows to delete`);
  console.log('='.repeat(78));
  for (const m of merges.slice(0, 25)) {
    console.log(`  KEEP  #${m.survivor.id} "${m.survivor.name}" (${refCounts.get(m.survivor.id) ?? 0} refs, espn=${m.survivor.espn_id ?? '-'})`);
    for (const l of m.losers) {
      console.log(`   └─ merge #${l.id} "${l.name}" (${refCounts.get(l.id) ?? 0} refs, espn=${l.espn_id ?? '-'})`);
    }
  }
  if (merges.length > 25) console.log(`  ... and ${merges.length - 25} more groups`);

  console.log('\n' + '='.repeat(78));
  console.log(`RENAME: ${renames.length} rows`);
  console.log('='.repeat(78));
  for (const r of renames.slice(0, 25)) {
    console.log(`  #${String(r.player.id).padEnd(5)} "${r.player.name}" → "${r.newName}"`);
  }
  if (renames.length > 25) console.log(`  ... and ${renames.length - 25} more`);

  console.log('\n' + '='.repeat(78));
  console.log(`BACKFILL espn_id: ${backfills.length} rows`);
  console.log('='.repeat(78));
  for (const b of backfills.slice(0, 25)) {
    console.log(`  #${String(b.player.id).padEnd(5)} "${b.player.name}" → espn_id ${b.espnId}`);
  }
  if (backfills.length > 25) console.log(`  ... and ${backfills.length - 25} more`);

  console.log('\n' + '='.repeat(78));
  console.log(`NEEDS MANUAL REVIEW (not merged): ${needsReview.length} groups`);
  console.log('='.repeat(78));
  console.log('  ESPN lists more than one player under these names — merging would risk');
  console.log('  combining two different people, so they are left alone.');
  for (const r of needsReview) {
    console.log(`  ${r.key}`);
    for (const p of r.rows) {
      console.log(`   • #${String(p.id).padEnd(5)} "${p.name}" (${refCounts.get(p.id) ?? 0} refs, espn=${p.espn_id ?? '-'})`);
    }
  }

  const stillUnmatched = players.filter(p => {
    const key = playerGroupKey(p.name, p.position);
    const inMerge = merges.find(m => m.losers.some(l => l.id === p.id));
    if (inMerge) return false;
    if (p.espn_id) return false;
    if (backfills.some(b => b.player.id === p.id)) return false;
    return (refCounts.get(p.id) ?? 0) > 0 && !espnIndex.has(key);
  });
  console.log(`\nStill without espn_id after backfill (referenced rows only): ${stillUnmatched.length}`);
  console.log('  These are pre-2018 players ESPN no longer lists — expected, and harmless.');
  console.log('  samples:', stillUnmatched.slice(0, 8).map(p => `"${p.name}"`).join(', '));

  if (!APPLY) {
    console.log('\n🔍 Dry run complete. Re-run with --apply to execute.');
    return;
  }

  // ---------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------
  console.log('\n⚠️  Applying changes...\n');

  // survivor id for every loser id
  const survivorOf = new Map<number, number>();
  for (const m of merges) {
    for (const l of m.losers) survivorOf.set(l.id, m.survivor.id);
  }
  const loserIds = [...survivorOf.keys()];

  // ---- Snapshot everything this run will change, BEFORE changing any of it.
  console.log('  Snapshotting current state for undo...');
  const affectedRefs: { table: string; row: any }[] = [];
  for (const { table } of REFERENCING_TABLES) {
    for (let i = 0; i < loserIds.length; i += 100) {
      const { data, error } = await supabase
        .from(table).select('*').in('player_id', loserIds.slice(i, i + 100));
      if (error) continue;
      for (const row of data ?? []) affectedRefs.push({ table, row });
    }
  }

  const touchedPlayerIds = new Set<number>([
    ...renames.map(r => r.player.id),
    ...backfills.map(b => b.player.id),
  ]);

  const backup = {
    ranAt: new Date().toISOString(),
    note: 'Undo data for cleanup-players.ts. deletedPlayers can be re-inserted; '
      + 'affectedRefs holds each reference row exactly as it was before repointing.',
    deletedPlayers: merges.flatMap(m => m.losers),
    originalPlayerFields: players
      .filter(p => touchedPlayerIds.has(p.id))
      .map(p => ({ id: p.id, name: p.name, espn_id: p.espn_id })),
    affectedRefs,
  };

  const backupPath = `scripts/.cleanup-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`  💾 undo data written to ${backupPath} (${affectedRefs.length} reference rows)\n`);

  // ---- 1. Repoint references from losers to survivors.
  let repointed = 0;
  let droppedRefs = 0;
  for (const { table, conflictKey } of REFERENCING_TABLES) {
    const rows = affectedRefs.filter(r => r.table === table).map(r => r.row);

    for (const row of rows) {
      const survivorId = survivorOf.get(row.player_id);
      if (!survivorId) continue;

      if (conflictKey) {
        // Would repointing collide with an existing survivor row?
        let q = supabase.from(table).select('id').eq('player_id', survivorId);
        for (const k of conflictKey) q = q.eq(k, row[k]);
        const { data: clash } = await q;
        if (clash?.length) {
          await supabase.from(table).delete().eq('id', row.id);
          droppedRefs++;
          continue;
        }
      }
      await supabase.from(table).update({ player_id: survivorId }).eq('id', row.id);
      repointed++;
    }
  }
  console.log(`  ✅ ${repointed} references repointed, ${droppedRefs} dropped as duplicates`);

  // 2. Rename + backfill on survivors.
  for (const r of renames) {
    await supabase.from('players').update({ name: r.newName }).eq('id', r.player.id);
  }
  console.log(`  ✅ ${renames.length} names cleaned`);

  for (const b of backfills) {
    await supabase.from('players').update({ espn_id: String(b.espnId) }).eq('id', b.player.id);
  }
  console.log(`  ✅ ${backfills.length} espn_ids backfilled`);

  // 3. Delete the merged-away rows.
  for (let i = 0; i < loserIds.length; i += 100) {
    await supabase.from('players').delete().in('id', loserIds.slice(i, i + 100));
  }
  console.log(`  ✅ ${loserIds.length} duplicate rows deleted`);

  console.log('\n✅ Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
