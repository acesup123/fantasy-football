/**
 * Seed Supabase from ESPN Fantasy Football API.
 *
 * Pulls: owners, seasons, standings, championship results (2018-2025).
 * Does NOT pull: draft history (provided via Excel).
 *
 * Usage:
 *   npx tsx scripts/seed-from-espn.ts
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ESPN_S2
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// CONFIG
// ============================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ESPN_LEAGUE_ID = 130046;
const ESPN_SWID = '{E66646D5-DB34-4E80-9E1C-501BFDF177FF}';
const ESPN_S2 = process.env.ESPN_S2!;
const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// OWNER MAPPING
// ============================================================

interface OwnerEntry {
  name: string;
  joinedYear: number;
  isActive: boolean;
  isCommissioner: boolean;
}

const ALL_OWNERS: OwnerEntry[] = [
  { name: 'Alex Altman',     joinedYear: 2010, isActive: true,  isCommissioner: true },
  { name: 'Joel Oubre',      joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Kevin Whitlock',  joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Bill Kling',      joinedYear: 2010, isActive: false, isCommissioner: false },
  { name: 'Ryan Parrilla',   joinedYear: 2021, isActive: true,  isCommissioner: false },
  { name: 'Kelly Mann',      joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Justin Choy',     joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Ed Lang',         joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Sal Singh',       joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Navi Singh',      joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Aaron Schwartz',  joinedYear: 2010, isActive: false, isCommissioner: false },
  { name: 'Marcus Moore',    joinedYear: 2019, isActive: true,  isCommissioner: false },
  { name: 'Jason McCartney',  joinedYear: 2010, isActive: true,  isCommissioner: false },
  { name: 'Lance Michihira', joinedYear: 2010, isActive: true,  isCommissioner: false },
];

// ESPN Team ID → owner name by year range
const TEAM_OWNERS: Record<number, { name: string; from: number; to: number }[]> = {
  1:  [{ name: 'Alex Altman',    from: 2010, to: 9999 }],
  2:  [{ name: 'Joel Oubre',     from: 2010, to: 9999 }],
  3:  [{ name: 'Kevin Whitlock',  from: 2010, to: 9999 }],
  4:  [
    { name: 'Bill Kling',      from: 2010, to: 2020 },
    { name: 'Ryan Parrilla',   from: 2021, to: 9999 },
  ],
  5:  [{ name: 'Kelly Mann',     from: 2010, to: 9999 }],
  6:  [{ name: 'Justin Choy',    from: 2010, to: 9999 }],
  7:  [{ name: 'Ed Lang',        from: 2010, to: 9999 }],
  8:  [{ name: 'Sal Singh',      from: 2010, to: 9999 }],
  9:  [{ name: 'Navi Singh',     from: 2010, to: 9999 }],
  10: [
    { name: 'Aaron Schwartz',  from: 2010, to: 2018 },
    { name: 'Marcus Moore',    from: 2019, to: 9999 },
  ],
  11: [{ name: 'Jason McCartney', from: 2010, to: 9999 }],
  12: [{ name: 'Lance Michihira', from: 2010, to: 9999 }],
};

function getOwnerName(teamId: number, year: number): string {
  const entries = TEAM_OWNERS[teamId] ?? [];
  for (const e of entries) {
    if (year >= e.from && year <= e.to) return e.name;
  }
  return 'Unknown';
}

// ============================================================
// ESPN API
// ============================================================

async function espnFetch(year: number, views: string[]): Promise<any> {
  const viewParams = views.map(v => `view=${v}`).join('&');
  const url = `${ESPN_BASE}/${year}/segments/0/leagues/${ESPN_LEAGUE_ID}?${viewParams}`;
  const resp = await fetch(url, {
    headers: {
      Cookie: `SWID=${ESPN_SWID}; espn_s2=${ESPN_S2}`,
    },
  });
  return resp.json();
}

// ============================================================
// SEED FUNCTIONS
// ============================================================

async function seedOwners(): Promise<Map<string, string>> {
  console.log('\n📋 Seeding owners...');
  const ownerIdMap = new Map<string, string>(); // name → uuid

  for (const owner of ALL_OWNERS) {
    const { data, error } = await supabase
      .from('owners')
      .upsert(
        {
          name: owner.name,
          team_name: owner.name, // Will be updated with team names
          joined_year: owner.joinedYear,
          is_active: owner.isActive,
          is_commissioner: owner.isCommissioner,
        },
        { onConflict: 'email' } // Won't conflict since no emails yet — effectively inserts
      )
      .select()
      .single();

    if (error) {
      // Try insert instead
      const { data: inserted, error: insertError } = await supabase
        .from('owners')
        .insert({
          name: owner.name,
          team_name: owner.name,
          joined_year: owner.joinedYear,
          is_active: owner.isActive,
          is_commissioner: owner.isCommissioner,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`  ❌ ${owner.name}: ${insertError.message}`);
        continue;
      }
      ownerIdMap.set(owner.name, inserted!.id);
      console.log(`  ✅ ${owner.name} (${inserted!.id})`);
    } else {
      ownerIdMap.set(owner.name, data!.id);
      console.log(`  ✅ ${owner.name} (${data!.id})`);
    }
  }

  return ownerIdMap;
}

async function seedSeasonsAndResults(ownerIdMap: Map<string, string>) {
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

  for (const year of years) {
    console.log(`\n📅 Seeding ${year} season...`);

    // Fetch standings
    const standingsData = await espnFetch(year, ['mTeam', 'mStandings']);
    if (standingsData.messages) {
      console.log(`  ⚠️ ${year}: Not available`);
      continue;
    }

    // Fetch championship
    const matchupData = await espnFetch(year, ['mTeam', 'mMatchup', 'mMatchupScore']);
    const champGames = (matchupData.schedule ?? []).filter(
      (m: any) => m.playoffTierType === 'WINNERS_BRACKET'
    );
    let championTeamId: number | null = null;
    let runnerUpTeamId: number | null = null;

    if (champGames.length > 0) {
      const final = champGames.reduce((a: any, b: any) =>
        (a.matchupPeriodId ?? 0) > (b.matchupPeriodId ?? 0) ? a : b
      );
      const homeId = final.home?.teamId;
      const awayId = final.away?.teamId;
      if (final.winner === 'HOME') {
        championTeamId = homeId;
        runnerUpTeamId = awayId;
      } else {
        championTeamId = awayId;
        runnerUpTeamId = homeId;
      }
    }

    // Insert season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .insert({
        year,
        draft_status: 'complete',
        draft_order: [],
        is_current: year === 2025,
      })
      .select()
      .single();

    if (seasonError) {
      console.error(`  ❌ Season ${year}: ${seasonError.message}`);
      continue;
    }
    console.log(`  ✅ Season created (id: ${season!.id})`);

    // Insert results for each team
    const teams = standingsData.teams ?? [];
    for (const team of teams) {
      const espnTeamId = team.id;
      const ownerName = getOwnerName(espnTeamId, year);
      const ownerId = ownerIdMap.get(ownerName);

      if (!ownerId) {
        console.error(`  ⚠️ No owner ID for ${ownerName} (ESPN Team ${espnTeamId})`);
        continue;
      }

      const rec = team.record?.overall ?? {};
      const seed = team.playoffSeed ?? null;

      // Determine playoff result
      let playoffResult: string | null = null;
      if (espnTeamId === championTeamId) playoffResult = 'champion';
      else if (espnTeamId === runnerUpTeamId) playoffResult = 'runner_up';
      // Could determine 3rd place and eliminated teams from more matchup data,
      // but champion/runner-up is the most important

      const { error: resultError } = await supabase
        .from('season_results')
        .insert({
          season_id: season!.id,
          owner_id: ownerId,
          wins: rec.wins ?? 0,
          losses: rec.losses ?? 0,
          ties: rec.ties ?? 0,
          points_for: rec.pointsFor ?? 0,
          points_against: rec.pointsAgainst ?? 0,
          playoff_seed: seed,
          playoff_result: playoffResult,
          regular_season_finish: seed,
        });

      if (resultError) {
        console.error(`  ❌ ${ownerName} ${year}: ${resultError.message}`);
      } else {
        const marker = playoffResult === 'champion' ? ' 🏆' : playoffResult === 'runner_up' ? ' 🥈' : '';
        console.log(`  ✅ ${ownerName}: ${rec.wins}-${rec.losses} (Seed ${seed})${marker}`);
      }
    }
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🏈 Fantasy Football ESPN → Supabase Seeder');
  console.log('==========================================');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE env vars');
    process.exit(1);
  }
  if (!ESPN_S2) {
    console.error('Missing ESPN_S2 env var');
    process.exit(1);
  }

  const ownerIdMap = await seedOwners();
  console.log(`\n📊 ${ownerIdMap.size} owners seeded`);

  await seedSeasonsAndResults(ownerIdMap);

  console.log('\n✅ Done!');
}

main().catch(console.error);
