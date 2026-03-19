import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { DraftPick, Trade, Season } from '@/types/database';

type DraftPickCallback = (pick: DraftPick) => void;
type TradeCallback = (trade: Trade) => void;
type DraftStatusCallback = (season: Partial<Season>) => void;

interface DraftSubscriptions {
  picksChannel: RealtimeChannel;
  tradesChannel: RealtimeChannel;
  statusChannel: RealtimeChannel;
  unsubscribeAll: () => void;
}

/**
 * Subscribe to all real-time draft events for a season.
 *
 * Three channels:
 * 1. draft-picks — pick INSERT/UPDATE (new picks made)
 * 2. trades — trade INSERT/UPDATE (proposals, accepts, declines)
 * 3. draft-status — season UPDATE (current pick number, draft status changes)
 */
export function subscribeToDraft(
  supabase: SupabaseClient,
  seasonId: number,
  callbacks: {
    onPick: DraftPickCallback;
    onTrade: TradeCallback;
    onStatusChange: DraftStatusCallback;
  }
): DraftSubscriptions {
  const picksChannel = supabase
    .channel(`draft-picks-${seasonId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'draft_picks',
        filter: `season_id=eq.${seasonId}`,
      },
      (payload) => {
        callbacks.onPick(payload.new as DraftPick);
      }
    )
    .subscribe();

  const tradesChannel = supabase
    .channel(`trades-${seasonId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trades',
        filter: `season_id=eq.${seasonId}`,
      },
      (payload) => {
        callbacks.onTrade(payload.new as Trade);
      }
    )
    .subscribe();

  const statusChannel = supabase
    .channel(`draft-status-${seasonId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'seasons',
        filter: `id=eq.${seasonId}`,
      },
      (payload) => {
        callbacks.onStatusChange(payload.new as Partial<Season>);
      }
    )
    .subscribe();

  return {
    picksChannel,
    tradesChannel,
    statusChannel,
    unsubscribeAll: () => {
      supabase.removeChannel(picksChannel);
      supabase.removeChannel(tradesChannel);
      supabase.removeChannel(statusChannel);
    },
  };
}
