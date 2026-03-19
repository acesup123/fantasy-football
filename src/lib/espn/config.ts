/**
 * ESPN Fantasy Football API configuration and mappings.
 *
 * League ID: 130046
 * Active since: 2010 (ESPN API data available from 2018)
 */

export const ESPN_CONFIG = {
  leagueId: 130046,
  swid: '{E66646D5-DB34-4E80-9E1C-501BFDF177FF}',
  // espn_s2 stored in .env.local as ESPN_S2
  baseUrl: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons',
} as const;

/**
 * ESPN Team ID → Owner mapping.
 *
 * Some teams changed owners:
 *   Team 4: Bill Kling (2018-2020) → Ryan Parrilla (2021+)
 *   Team 10: Aaron Schwartz (2018) → Marcus Moore (2019+)
 */
export const ESPN_TEAM_OWNERS: Record<number, OwnerHistory[]> = {
  1:  [{ name: 'Alex Altman',     from: 2010, to: null }],
  2:  [{ name: 'Joel Oubre',      from: 2010, to: null }],
  3:  [{ name: 'Kevin Whitlock',   from: 2010, to: null }],
  4:  [
    { name: 'Bill Kling',       from: 2010, to: 2020 },
    { name: 'Ryan Parrilla',    from: 2021, to: null },
  ],
  5:  [{ name: 'Kelly Mann',      from: 2010, to: null }],
  6:  [{ name: 'Justin Choy',     from: 2010, to: null }],
  7:  [{ name: 'Ed Lang',         from: 2010, to: null }],
  8:  [{ name: 'Sal Singh',       from: 2010, to: null }],
  9:  [{ name: 'Navi Singh',      from: 2010, to: null }],
  10: [
    { name: 'Aaron Schwartz',   from: 2010, to: 2015 },
    { name: 'Marcus Moore',     from: 2016, to: null },
  ],
  11: [{ name: 'Jason McCartney',  from: 2010, to: null }],
  12: [
    { name: 'Matt B',             from: 2010, to: 2017 },
    { name: 'Lance Michihira',    from: 2018, to: null },
  ],
};

interface OwnerHistory {
  name: string;
  from: number;      // first season year
  to: number | null;  // null = still active
}

/**
 * Get the owner name for a given ESPN team ID and season year.
 */
export function getOwnerForTeam(teamId: number, year: number): string {
  const history = ESPN_TEAM_OWNERS[teamId];
  if (!history) return 'Unknown';

  for (const entry of history) {
    const endYear = entry.to ?? 9999;
    if (year >= entry.from && year <= endYear) {
      return entry.name;
    }
  }
  return 'Unknown';
}

/**
 * All unique owners who have ever been in the league.
 */
export const ALL_OWNERS = [
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
  { name: 'Matt B',          joinedYear: 2010, isActive: false, isCommissioner: false },
  { name: 'Lance Michihira', joinedYear: 2018, isActive: true,  isCommissioner: false },
] as const;
