/**
 * Who owns which draft picks, by round, for a season.
 *
 * Before a draft is initialized there are no `draft_picks` rows, so round
 * ownership is derived instead: every owner starts with one pick per round,
 * then traded future picks are applied on top.
 *
 * A keeper occupies one of its owner's picks, so an owner can only keep a
 * player in a round they actually hold a pick in.
 */

import { LEAGUE_CONFIG } from '@/types/database';

/** owner_id → how many picks they hold in each round (round → count). */
export type RoundOwnership = Map<string, Map<number, number>>;

export interface PickTrade {
  fromOwnerId: string;
  toOwnerId: string;
  round: number;
}

/**
 * Build round ownership for a season: one pick per owner per round, adjusted
 * by any traded future picks for that season.
 */
export function buildRoundOwnership(
  ownerIds: string[],
  trades: PickTrade[],
  numRounds: number = LEAGUE_CONFIG.NUM_ROUNDS
): RoundOwnership {
  const ownership: RoundOwnership = new Map();

  for (const ownerId of ownerIds) {
    const rounds = new Map<number, number>();
    for (let r = 1; r <= numRounds; r++) rounds.set(r, 1);
    ownership.set(ownerId, rounds);
  }

  for (const trade of trades) {
    const from = ownership.get(trade.fromOwnerId);
    const to = ownership.get(trade.toOwnerId);
    if (!from || !to) continue;

    from.set(trade.round, Math.max(0, (from.get(trade.round) ?? 0) - 1));
    to.set(trade.round, (to.get(trade.round) ?? 0) + 1);
  }

  return ownership;
}

/**
 * Read this season's traded future picks out of `trade_assets`.
 *
 * Only accepted trades count — pending or declined ones haven't moved anything.
 */
export async function fetchPickTrades(
  supabase: any,
  seasonYear: number
): Promise<PickTrade[]> {
  const { data, error } = await supabase
    .from('trade_assets')
    .select('from_owner_id, to_owner_id, future_round, future_season_year, trades(status)')
    .eq('asset_type', 'future_pick')
    .eq('future_season_year', seasonYear);

  if (error || !data) return [];

  return data
    .filter((a: any) => a.trades?.status === 'accepted' && a.future_round)
    .map((a: any) => ({
      fromOwnerId: a.from_owner_id,
      toOwnerId: a.to_owner_id,
      round: a.future_round,
    }));
}

/** Compact "R3, R8×2" style summary of the rounds an owner holds. */
export function describeOwnership(rounds: Map<number, number>): string {
  const parts: string[] = [];
  for (const [round, count] of [...rounds.entries()].sort((a, b) => a[0] - b[0])) {
    if (count === 0) continue;
    parts.push(count > 1 ? `R${round}×${count}` : `R${round}`);
  }
  return parts.join(', ');
}
