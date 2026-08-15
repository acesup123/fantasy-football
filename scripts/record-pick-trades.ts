/**
 * Record traded future draft picks.
 *
 * Pick ownership for an upcoming season can't live in `draft_picks` yet — those
 * rows don't exist until the lottery sets the draft order and the draft is
 * initialized. `trade_assets` carries them instead, via
 * asset_type='future_pick' plus future_season_year / future_round.
 *
 * The keeper sync reads these to check that every keeper sits on a round its
 * owner actually holds, and /api/draft/initialize can apply them later.
 *
 * Idempotent: a trade already on record is left alone.
 *
 * Usage:
 *   npx tsx scripts/record-pick-trades.ts            # dry run
 *   npx tsx scripts/record-pick-trades.ts --apply
 */

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Trades agreed during the 2025 season involving 2026 picks.
 *
 *   Sal traded his 3rd to Jason for Jason's 15th
 *   Kelly traded his 8th to Marcus for Marcus's 11th
 */
const PICK_TRADES = [
  {
    pickYear: 2026,
    agreedInSeason: 2025,
    notes: "Sal's 2026 3rd for Jason's 2026 15th",
    sides: [
      { from: 'Sal Singh', to: 'Jason McCartney', round: 3 },
      { from: 'Jason McCartney', to: 'Sal Singh', round: 15 },
    ],
  },
  {
    pickYear: 2026,
    agreedInSeason: 2025,
    notes: "Kelly's 2026 8th for Marcus's 2026 11th",
    sides: [
      { from: 'Kelly Mann', to: 'Marcus Moore', round: 8 },
      { from: 'Marcus Moore', to: 'Kelly Mann', round: 11 },
    ],
  },
];

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE\n' : '🔍 DRY RUN — nothing will be written\n');

  const { data: owners } = await supabase.from('owners').select('id, name');
  const ownerId = new Map((owners ?? []).map(o => [o.name, o.id]));

  const { data: seasons } = await supabase.from('seasons').select('id, year');
  const seasonId = new Map((seasons ?? []).map(s => [s.year, s.id]));

  // What's already recorded, so re-runs don't duplicate.
  const { data: existing } = await supabase
    .from('trade_assets')
    .select('from_owner_id, to_owner_id, future_round, future_season_year')
    .eq('asset_type', 'future_pick');

  const seen = new Set(
    (existing ?? []).map(
      (a: any) => `${a.from_owner_id}|${a.to_owner_id}|${a.future_round}|${a.future_season_year}`
    )
  );

  for (const trade of PICK_TRADES) {
    const season = seasonId.get(trade.agreedInSeason);
    if (!season) {
      console.log(`❌ No season row for ${trade.agreedInSeason} — skipping "${trade.notes}"`);
      continue;
    }

    const sides = trade.sides.map(s => ({
      ...s,
      fromId: ownerId.get(s.from),
      toId: ownerId.get(s.to),
    }));

    const missing = sides.filter(s => !s.fromId || !s.toId);
    if (missing.length > 0) {
      console.log(`❌ Unknown owner in "${trade.notes}" — skipping`);
      continue;
    }

    const alreadyRecorded = sides.every(s =>
      seen.has(`${s.fromId}|${s.toId}|${s.round}|${trade.pickYear}`)
    );
    if (alreadyRecorded) {
      console.log(`✓ Already recorded: ${trade.notes}`);
      continue;
    }

    console.log(`+ ${trade.notes}`);
    for (const s of sides) {
      console.log(`    ${s.from} → ${s.to}: ${trade.pickYear} round ${s.round}`);
    }

    if (!APPLY) continue;

    // The two owners are the trade's parties; direction is per-asset.
    const { data: tradeRow, error: tradeErr } = await supabase
      .from('trades')
      .insert({
        season_id: season,
        proposer_id: sides[0].fromId,
        accepter_id: sides[0].toId,
        status: 'accepted',
        context: 'in_season',
        resolved_at: new Date().toISOString(),
        notes: trade.notes,
      })
      .select()
      .single();

    if (tradeErr || !tradeRow) {
      console.log(`  ❌ Failed to create trade: ${tradeErr?.message}`);
      continue;
    }

    const { error: assetErr } = await supabase.from('trade_assets').insert(
      sides.map(s => ({
        trade_id: tradeRow.id,
        from_owner_id: s.fromId,
        to_owner_id: s.toId,
        asset_type: 'future_pick',
        future_season_year: trade.pickYear,
        future_round: s.round,
        description: `${trade.pickYear} round ${s.round} pick`,
      }))
    );

    if (assetErr) {
      console.log(`  ❌ Failed to create assets: ${assetErr.message}`);
      await supabase.from('trades').delete().eq('id', tradeRow.id);
      continue;
    }
    console.log(`  ✅ recorded as trade #${tradeRow.id}`);
  }

  if (!APPLY) console.log('\n🔍 Dry run complete. Re-run with --apply to record.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
