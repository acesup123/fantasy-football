/**
 * Recompute keepers and rebuild the draft board for a season.
 *
 * Needed when a keeper rule changes after the draft has already been
 * initialized. /api/keepers/sync refuses once keepers are locked and
 * /api/draft/initialize refuses once the season is drafting — both correct
 * guards — so this does the work directly, under one hard safety rule:
 *
 *   It REFUSES if any live pick has been made. Rebuilding would erase it.
 *
 * Keeper slots, traded picks and the pick pointer are all regenerated, so the
 * board ends up exactly as a fresh initialize would have produced it.
 *
 * Usage:
 *   npx tsx scripts/rebuild-draft-board.ts            # dry run
 *   npx tsx scripts/rebuild-draft-board.ts --apply
 */

import { createClient } from '@supabase/supabase-js';
import { fetchKeeperElections } from '../src/lib/espn/keepers';
import { fetchFinalRosters, keepsDraftStatus } from '../src/lib/espn/rosters';
import { getOwnerForTeam } from '../src/lib/espn/config';
import { computeKeeperCost, resolveRoundConflicts, type DraftHistoryEntry } from '../src/lib/keepers/cost-calculator';
import { buildRoundOwnership, fetchPickTrades } from '../src/lib/draft/pick-ownership';
import { generateSnakeOrder } from '../src/lib/draft/snake-order';

const APPLY = process.argv.includes('--apply');
const YEAR = 2026;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log(APPLY ? `⚠️  APPLY — rebuilding ${YEAR}\n` : `🔍 DRY RUN — ${YEAR}\n`);

  const { data: season } = await supabase
    .from('seasons')
    .select('id, draft_status, draft_order, current_pick_number')
    .eq('year', YEAR)
    .single();
  if (!season) throw new Error(`no season row for ${YEAR}`);

  // ---- Safety: never destroy a pick someone actually made.
  const { count: livePicks } = await supabase
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', season.id)
    .eq('is_keeper', false)
    .not('player_id', 'is', null);

  if ((livePicks ?? 0) > 0) {
    console.log(`❌ ${livePicks} live pick(s) already made — refusing to rebuild.`);
    process.exit(1);
  }
  console.log('✅ no live picks made — safe to rebuild\n');

  // ---- Recompute keepers from ESPN + draft history
  const { elections } = await fetchKeeperElections(YEAR);
  const priorRosters = await fetchFinalRosters(YEAR - 1);

  const { data: owners } = await supabase.from('owners').select('id, name');
  const ownerIdByName = new Map((owners ?? []).map(o => [o.name, o.id]));
  const nameByOwnerId = new Map((owners ?? []).map(o => [o.id, o.name]));

  const { data: players } = await supabase
    .from('players')
    .select('id, name, espn_id')
    .in('espn_id', elections.map(e => String(e.espnPlayerId)));
  const playerByEspnId = new Map((players ?? []).map(p => [p.espn_id, p]));

  const { data: seasons } = await supabase.from('seasons').select('id, year');
  const yearBySeasonId = new Map((seasons ?? []).map(s => [s.id, s.year]));
  const { data: picks } = await supabase
    .from('draft_picks')
    .select('season_id, player_id, round, is_keeper, keeper_year')
    .in('player_id', (players ?? []).map(p => p.id));

  const historyByPlayer = new Map<number, DraftHistoryEntry[]>();
  for (const pick of picks ?? []) {
    const y = yearBySeasonId.get(pick.season_id);
    if (!y || y >= YEAR) continue; // this season's own board isn't history
    if (!historyByPlayer.has(pick.player_id)) historyByPlayer.set(pick.player_id, []);
    historyByPlayer.get(pick.player_id)!.push({
      year: y, round: pick.round, isKeeper: Boolean(pick.is_keeper), keeperYear: pick.keeper_year,
    });
  }

  const pickTrades = await fetchPickTrades(supabase, YEAR);
  const ownership = buildRoundOwnership((owners ?? []).map(o => o.id), pickTrades);

  interface Prepared { ownerId: string; ownerName: string; playerId: number; playerName: string; rank: number; cost: ReturnType<typeof computeKeeperCost>; lastRound: number | null }
  const prepared: Prepared[] = [];

  for (const e of elections) {
    const ownerName = getOwnerForTeam(e.espnTeamId, YEAR);
    const ownerId = ownerIdByName.get(ownerName);
    const player = playerByEspnId.get(String(e.espnPlayerId));
    if (!ownerId || !player) { console.log(`  ⚠️  skipped ${e.playerName}`); continue; }

    const history = historyByPlayer.get(player.id) ?? [];
    const priorEntry = priorRosters.byPlayerId.get(e.espnPlayerId);
    const cost = computeKeeperCost(history, YEAR, {
      keepsDraftStatus: priorEntry ? keepsDraftStatus(priorEntry.acquisitionType) : false,
    });
    if (!cost.eligible) { console.log(`  ⚠️  ${e.playerName} ineligible: ${cost.reason}`); continue; }

    prepared.push({
      ownerId, ownerName, playerId: player.id, playerName: player.name,
      rank: e.rank, cost,
      lastRound: history.length ? history[history.length - 1].round : null,
    });
  }

  const byOwner = new Map<string, Prepared[]>();
  for (const p of prepared) {
    if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, []);
    byOwner.get(p.ownerId)!.push(p);
  }

  const keeperRows: any[] = [];
  const changes: string[] = [];
  const { data: currentKeepers } = await supabase
    .from('keepers').select('player_id, round_cost').eq('season_id', season.id);
  const oldCost = new Map((currentKeepers ?? []).map(k => [k.player_id, k.round_cost]));

  for (const [ownerId, ks] of byOwner) {
    const resolved = resolveRoundConflicts(
      ks.map(k => ({ playerName: k.playerName, baseRound: k.cost.roundCost, rank: k.rank })),
      ownership.get(ownerId)
    );
    for (const r of resolved) {
      const k = ks.find(x => x.playerName === r.playerName)!;
      if (r.unresolved) console.log(`  ⚠️  ${k.ownerName}: ${k.playerName} ${r.unresolved}`);
      const before = oldCost.get(k.playerId);
      if (before !== undefined && before !== r.finalRound) {
        changes.push(`   ${k.ownerName.padEnd(17)} ${k.playerName.padEnd(22)} R${before} → R${r.finalRound}`);
      }
      keeperRows.push({
        season_id: season.id, owner_id: ownerId, player_id: k.playerId,
        keeper_year: k.cost.keeperYear, round_cost: r.finalRound,
        original_draft_round: k.lastRound, source_type: k.cost.sourceType,
      });
    }
  }

  console.log(`keepers: ${keeperRows.length}`);
  console.log(`round changes vs current: ${changes.length}`);
  changes.forEach(c => console.log(c));

  // ---- Rebuild the board
  const slots = generateSnakeOrder(season.draft_order as string[]);
  const tradedAway = new Map<string, number[]>();
  for (const t of pickTrades) {
    if (!tradedAway.has(t.fromOwnerId)) tradedAway.set(t.fromOwnerId, []);
    tradedAway.get(t.fromOwnerId)!.push(t.round);
  }
  const currentOwnerOf = (slot: { round: number; ownerId: string }) => {
    const gave = tradedAway.get(slot.ownerId);
    if (!gave) return slot.ownerId;
    const i = gave.indexOf(slot.round);
    if (i === -1) return slot.ownerId;
    gave.splice(i, 1);
    return pickTrades.find(t => t.fromOwnerId === slot.ownerId && t.round === slot.round)?.toOwnerId ?? slot.ownerId;
  };

  const remaining = new Map<string, any[]>();
  for (const r of keeperRows) {
    if (!remaining.has(r.owner_id)) remaining.set(r.owner_id, []);
    remaining.get(r.owner_id)!.push({ ...r });
  }

  const now = new Date().toISOString();
  const pickRows = slots.map(slot => {
    const cur = currentOwnerOf(slot);
    const ks = remaining.get(cur) ?? [];
    const m = ks.find(k => k.round_cost === slot.round);
    if (m) ks.splice(ks.indexOf(m), 1);
    return {
      season_id: season.id, round: slot.round, pick_in_round: slot.pickInRound,
      overall_pick: slot.overallPick,
      original_owner_id: slot.ownerId, current_owner_id: cur,
      player_id: m?.player_id ?? null, is_keeper: Boolean(m),
      keeper_year: m?.keeper_year ?? null, picked_at: m ? now : null,
      is_auto_pick: false,
    };
  });

  const unplaced = [...remaining.values()].flat();
  const firstOpen = pickRows.find(p => p.player_id === null)!;
  console.log(`\nboard: ${pickRows.length} slots | keeper slots ${pickRows.filter(p => p.is_keeper).length} | unplaced ${unplaced.length}`);
  if (unplaced.length) console.log('  ❌', unplaced.map(u => u.player_id));
  console.log(`first open pick: overall ${firstOpen.overall_pick} — ${nameByOwnerId.get(firstOpen.current_owner_id)}`);

  if (!APPLY) { console.log('\n🔍 Dry run. Re-run with --apply.'); return; }

  await supabase.from('keepers').delete().eq('season_id', season.id);
  const { error: kErr } = await supabase.from('keepers').insert(keeperRows);
  if (kErr) throw new Error(`keepers insert: ${kErr.message}`);

  await supabase.from('draft_picks').delete().eq('season_id', season.id);
  for (let i = 0; i < pickRows.length; i += 90) {
    const { error } = await supabase.from('draft_picks').insert(pickRows.slice(i, i + 90));
    if (error) throw new Error(`picks insert: ${error.message}`);
  }
  await supabase.from('seasons')
    .update({ current_pick_number: firstOpen.overall_pick })
    .eq('id', season.id);

  console.log(`\n✅ rebuilt — ${keeperRows.length} keepers, ${pickRows.length} slots, on the clock: overall ${firstOpen.overall_pick}`);
}

main().catch(err => { console.error(err); process.exit(1); });
