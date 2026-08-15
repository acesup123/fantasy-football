/**
 * ESPN player pool → league player records.
 *
 * Resolves ESPN player IDs to names, positions and NFL teams so draft picks,
 * keepers and rosters can be matched to rows in the `players` table by
 * `espn_id` rather than by fuzzy name matching.
 */

import { espnPlayerPool } from './request';

export type LeaguePosition = 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';

export interface EspnPlayerInfo {
  espnId: number;
  name: string;
  position: LeaguePosition | null;
  nflTeam: string | null;
}

/** ESPN proTeamId → NFL abbreviation. 0 = free agent / no team. */
export const PRO_TEAM_ABBREV: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

/**
 * ESPN defaultPositionId → league position.
 *
 * The league only rosters offensive skill positions plus team defense, so
 * kickers and IDP slots map to null and are ignored.
 */
const POSITION_BY_ID: Record<number, LeaguePosition> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  16: 'DEF',
};

/**
 * ESPN encodes team defenses as negative player IDs: -16000 - proTeamId.
 * Returns the proTeamId, or null if this isn't a defense ID.
 *
 * A playerId of -1 means the slot was never filled (an unused draft pick).
 */
export function decodeDefenseId(playerId: number): number | null {
  if (playerId > -16001 || playerId < -16999) return null;
  return -playerId - 16000;
}

/** Build the synthetic player record for a team defense. */
function defenseInfo(playerId: number): EspnPlayerInfo | null {
  const proTeamId = decodeDefenseId(playerId);
  if (proTeamId === null) return null;

  const abbrev = PRO_TEAM_ABBREV[proTeamId];
  if (!abbrev) return null;

  return {
    espnId: playerId,
    name: `${abbrev} D/ST`,
    position: 'DEF',
    nflTeam: abbrev,
  };
}

/**
 * Fetch and index a season's full player pool.
 *
 * Team defenses are synthesized from the proTeam table rather than read from
 * the pool, so defenses resolve consistently across every season.
 */
export async function fetchPlayerIndex(year: number): Promise<Map<number, EspnPlayerInfo>> {
  const pool = await espnPlayerPool(year);
  const index = new Map<number, EspnPlayerInfo>();

  for (const p of pool) {
    const id = p?.id;
    if (typeof id !== 'number' || !p.fullName) continue;

    index.set(id, {
      espnId: id,
      name: p.fullName,
      position: POSITION_BY_ID[p.defaultPositionId] ?? null,
      nflTeam: PRO_TEAM_ABBREV[p.proTeamId] ?? null,
    });
  }

  // Every team defense, so historical D/ST picks always resolve.
  for (const proTeamId of Object.keys(PRO_TEAM_ABBREV)) {
    const playerId = -16000 - Number(proTeamId);
    const info = defenseInfo(playerId);
    if (info) index.set(playerId, info);
  }

  return index;
}

/**
 * Resolve a single ESPN player ID against an index, falling back to the
 * synthetic defense record for negative IDs the pool doesn't carry.
 */
export function resolvePlayer(
  index: Map<number, EspnPlayerInfo>,
  playerId: number
): EspnPlayerInfo | null {
  return index.get(playerId) ?? defenseInfo(playerId);
}

/** Position markers the spreadsheet imports prefixed names with. */
const POSITION_TOKENS = new Set(['QB', 'RB', 'WR', 'TE', 'DEF', 'DST', 'K', 'FLEX', 'BN']);

/**
 * NFL team markers the oldest imports prefixed names with ("NO Drew Brees").
 * Includes historical and alternate abbreviations, since the spelling drifted
 * between spreadsheets.
 */
const NFL_TEAM_TOKENS = new Set([
  ...Object.values(PRO_TEAM_ABBREV),
  'JAC', 'WAS', 'LA', 'SD', 'SDG', 'STL', 'OAK', 'NOR', 'GNB', 'KAN', 'SFO',
  'TAM', 'NWE', 'ARZ', 'BLT', 'CLV', 'HST', 'LVR', 'PHX', 'NWE', 'TEN',
]);

/**
 * Strip leading position and/or NFL-team markers from an imported name.
 *
 * Handles "RB, Adrian Peterson", "RB Adrian Peterson" and "Min Adrian Peterson".
 * Only strips while at least a first and last name remain, so a real name is
 * never eaten down to a single token.
 */
function stripImportPrefixes(raw: string): string {
  let s = raw.trim();

  // At most two markers (a position and a team) can precede the name.
  for (let i = 0; i < 2; i++) {
    const m = s.match(/^([A-Za-z/.]{1,4})\s*,?\s+(.+)$/);
    if (!m) break;

    const token = m[1].toUpperCase().replace(/[./]/g, '');
    const rest = m[2].trim();

    // Never strip down to a bare single token — that would destroy the name.
    if (!rest.includes(' ')) break;
    if (!POSITION_TOKENS.has(token) && !NFL_TEAM_TOKENS.has(token)) break;

    s = rest;
  }

  return s;
}

/**
 * Normalize a player name for duplicate detection and legacy name matching.
 *
 * The spreadsheet imports wrote names as "RB, Adrian Peterson",
 * "RB Adrian Peterson" or "Min Adrian Peterson", and generational suffixes
 * drift over time ("Michael Pittman" vs "Michael Pittman Jr."). All collapse
 * to the same key.
 */
export function normalizePlayerName(raw: string): string {
  return stripImportPrefixes(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip leading position/team prefixes from a spreadsheet-imported name. */
export function stripPositionPrefix(raw: string): string {
  return stripImportPrefixes(raw);
}

/**
 * NFL nicknames → abbreviation. Nicknames are unique league-wide, which makes
 * them the most reliable way to identify a team defense across the many
 * spellings the imports used ("PIT Pittsburgh Steelers", "Steelers Pittsburgh",
 * "San Francisco 49ers D/ST", "Los Chargers").
 */
const TEAM_NICKNAMES: Record<string, string> = {
  falcons: 'ATL', bills: 'BUF', bears: 'CHI', bengals: 'CIN', browns: 'CLE',
  cowboys: 'DAL', broncos: 'DEN', lions: 'DET', packers: 'GB', titans: 'TEN',
  colts: 'IND', chiefs: 'KC', raiders: 'LV', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG', jets: 'NYJ',
  eagles: 'PHI', cardinals: 'ARI', steelers: 'PIT', chargers: 'LAC',
  '49ers': 'SF', niners: 'SF', seahawks: 'SEA', buccaneers: 'TB', bucs: 'TB',
  commanders: 'WSH', redskins: 'WSH', panthers: 'CAR', jaguars: 'JAX',
  jags: 'JAX', ravens: 'BAL', texans: 'HOU',
};

/** proTeamId for each abbreviation, for building the ESPN defense player ID. */
const PRO_TEAM_ID_BY_ABBREV: Record<string, number> = Object.fromEntries(
  Object.entries(PRO_TEAM_ABBREV).map(([id, abbrev]) => [abbrev, Number(id)])
);

/**
 * Identify which team's defense a name refers to, by nickname first and then
 * by a bare abbreviation token. Returns null if it isn't recognisable.
 */
export function defenseAbbrev(name: string): string | null {
  const words = name.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);

  for (const w of words) {
    if (TEAM_NICKNAMES[w]) return TEAM_NICKNAMES[w];
  }
  for (const w of words) {
    const upper = w.toUpperCase();
    if (PRO_TEAM_ID_BY_ABBREV[upper]) return upper;
  }
  return null;
}

/** The ESPN player ID for a team defense, given its abbreviation. */
export function defenseEspnId(abbrev: string): number | null {
  const proTeamId = PRO_TEAM_ID_BY_ABBREV[abbrev];
  return proTeamId === undefined ? null : -16000 - proTeamId;
}

/**
 * The key two player rows must share to be considered the same player.
 *
 * Team defenses key on the team itself, since their names vary wildly across
 * imports; everyone else keys on normalized name plus position.
 */
export function playerGroupKey(name: string, position: string): string {
  if (position === 'DEF') {
    const abbrev = defenseAbbrev(name);
    if (abbrev) return `def|${abbrev}`;
  }
  return `${normalizePlayerName(name)}|${position}`;
}
