/**
 * Keeper elections from ESPN.
 *
 * ESPN is the source of truth for *who* each owner keeps: owners set their
 * keepers in ESPN before the keeper deadline, and it lands in
 * `teams[].draftStrategy.keeperPlayerIds`.
 *
 * ESPN is NOT the source of truth for what a keeper *costs*. Its
 * `playerPoolEntry.keeperValue` is a draft-slot field that doesn't follow this
 * league's escalation rules — it prices 2025 round-1 keepers like Christian
 * McCaffrey at round 9 and Bijan Robinson at round 3. Cost is computed from
 * draft history instead; see src/lib/keepers/cost-calculator.ts.
 */

import { espnLeague } from './request';

export interface EspnKeeperElection {
  espnTeamId: number;
  espnPlayerId: number;
  playerName: string;
  /** DRAFT | ADD | TRADE — how the owner acquired the player. */
  acquisitionType: string;
  /**
   * Player rank, lower is better. Used to decide who moves when two keepers
   * land on the same round. Superflex rank first, since that's this league's
   * format; PPR then ADP as fallbacks.
   */
  rank: number;
  rankSource: string;
}

/** Pull the best available ranking for a player, lower being better. */
function playerRank(player: any): { rank: number; rankSource: string } {
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

export interface KeeperElections {
  elections: EspnKeeperElection[];
  keeperLimit: number;
  deadline: Date | null;
  /** Player IDs an owner elected that aren't on their roster — a data problem. */
  offRoster: { espnTeamId: number; espnPlayerId: number }[];
}

/**
 * Read every team's keeper elections for a season.
 */
export async function fetchKeeperElections(year: number): Promise<KeeperElections> {
  const data = await espnLeague(year, ['mRoster', 'mTeam', 'mSettings']);

  const elections: EspnKeeperElection[] = [];
  const offRoster: { espnTeamId: number; espnPlayerId: number }[] = [];

  for (const team of data.teams ?? []) {
    const elected: number[] = team.draftStrategy?.keeperPlayerIds ?? [];
    if (elected.length === 0) continue;

    const rosterById = new Map<number, any>();
    for (const entry of team.roster?.entries ?? []) {
      if (typeof entry.playerId === 'number') rosterById.set(entry.playerId, entry);
    }

    for (const playerId of elected) {
      const entry = rosterById.get(playerId);
      if (!entry) {
        offRoster.push({ espnTeamId: team.id, espnPlayerId: playerId });
        continue;
      }
      const player = entry.playerPoolEntry?.player;
      elections.push({
        espnTeamId: team.id,
        espnPlayerId: playerId,
        playerName: player?.fullName ?? `ESPN #${playerId}`,
        acquisitionType: entry.acquisitionType ?? 'UNKNOWN',
        ...playerRank(player),
      });
    }
  }

  const draftSettings = data.settings?.draftSettings ?? {};

  return {
    elections,
    keeperLimit: draftSettings.keeperCount ?? 5,
    deadline: draftSettings.keeperDeadlineDate ? new Date(draftSettings.keeperDeadlineDate) : null,
    offRoster,
  };
}
