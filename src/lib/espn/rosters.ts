/**
 * End-of-season rosters from ESPN.
 *
 * A season's final roster is the keeper-eligible pool: it's who actually held
 * each player when the season ended, including anyone acquired by trade or off
 * waivers after the draft. Reconstructing that from draft picks and lineups
 * gets it wrong, because it attributes players to whoever drafted them.
 *
 * The acquisition type also decides whether a player keeps his draft status:
 * drafted or traded-for keeps it, dropped-and-re-added resets to free agent.
 */

import { espnLeague } from './request';

export type AcquisitionType = 'DRAFT' | 'TRADE' | 'ADD' | 'WAIVER' | string;

export interface RosterEntry {
  espnPlayerId: number;
  espnTeamId: number;
  playerName: string;
  acquisitionType: AcquisitionType;
  /** Epoch ms, or null when ESPN doesn't record one. */
  acquisitionDate: number | null;
  /** Player rank, lower is better (superflex, then PPR, then ADP). */
  rank: number;
  rankSource: string;
}

export interface FinalRosters {
  /** Every rostered player, keyed by ESPN player id. */
  byPlayerId: Map<number, RosterEntry>;
  /** Rostered players per ESPN team id. */
  byTeamId: Map<number, RosterEntry[]>;
  /** Trade deadline for the season, epoch ms. */
  tradeDeadline: number | null;
}

/** Pull the best available ranking for a player, lower being better. */
export function playerRank(player: any): { rank: number; rankSource: string } {
  const ranks = player?.draftRanksByRankType ?? {};

  if (typeof ranks.SUPERFLEX?.rank === 'number' && ranks.SUPERFLEX.rank > 0) {
    return { rank: ranks.SUPERFLEX.rank, rankSource: 'superflex' };
  }
  if (typeof ranks.PPR?.rank === 'number' && ranks.PPR.rank > 0) {
    return { rank: ranks.PPR.rank, rankSource: 'ppr' };
  }
  const adp = player?.ownership?.averageDraftPosition;
  if (typeof adp === 'number' && adp > 0) {
    return { rank: adp, rankSource: 'adp' };
  }
  return { rank: Number.MAX_SAFE_INTEGER, rankSource: 'unranked' };
}

/**
 * A player keeps his draft status if he was drafted by the team or acquired by
 * trade. Dropping him and picking him back up off the wire resets him to a
 * free agent, regardless of where he was originally drafted.
 */
export function keepsDraftStatus(acquisitionType: AcquisitionType): boolean {
  return acquisitionType === 'DRAFT' || acquisitionType === 'TRADE';
}

/**
 * Fetch a season's end-of-season rosters.
 */
export async function fetchFinalRosters(year: number): Promise<FinalRosters> {
  const data = await espnLeague(year, ['mRoster', 'mTeam', 'mSettings']);

  const byPlayerId = new Map<number, RosterEntry>();
  const byTeamId = new Map<number, RosterEntry[]>();

  for (const team of data.teams ?? []) {
    const entries: RosterEntry[] = [];

    for (const entry of team.roster?.entries ?? []) {
      if (typeof entry.playerId !== 'number') continue;
      const player = entry.playerPoolEntry?.player;

      const rosterEntry: RosterEntry = {
        espnPlayerId: entry.playerId,
        espnTeamId: team.id,
        playerName: player?.fullName ?? `ESPN #${entry.playerId}`,
        acquisitionType: entry.acquisitionType ?? 'UNKNOWN',
        acquisitionDate: typeof entry.acquisitionDate === 'number' ? entry.acquisitionDate : null,
        ...playerRank(player),
      };

      entries.push(rosterEntry);
      byPlayerId.set(entry.playerId, rosterEntry);
    }

    byTeamId.set(team.id, entries);
  }

  return {
    byPlayerId,
    byTeamId,
    tradeDeadline: data.settings?.tradeSettings?.deadlineDate ?? null,
  };
}
