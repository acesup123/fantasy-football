import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { fetchKeeperElections } from '@/lib/espn/keepers';
import { fetchFinalRosters, keepsDraftStatus } from '@/lib/espn/rosters';
import { hasEspnCredentials } from '@/lib/espn/request';
import { getOwnerForTeam } from '@/lib/espn/config';
import {
  computeKeeperCost,
  resolveRoundConflicts,
  type DraftHistoryEntry,
} from '@/lib/keepers/cost-calculator';
import {
  buildRoundOwnership,
  fetchPickTrades,
  describeOwnership,
} from '@/lib/draft/pick-ownership';

/**
 * GET /api/keepers/sync
 *
 * Pulls keeper elections from ESPN into the `keepers` table. ESPN is the
 * source of truth for who is kept; round cost is computed from draft history
 * because ESPN's own keeperValue doesn't follow this league's rules.
 *
 * Query params:
 *   ?season=2026  — season to sync (defaults to the upcoming season)
 *   ?dry=1        — report what would change without writing
 *   ?secret=xxx   — cron auth, matches CRON_SECRET
 *
 * Kept separate from /api/sync because keepers move once a year at the keeper
 * deadline, not daily with standings.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** The season owners are currently electing keepers for. */
function upcomingSeason(): number {
  const now = new Date();
  // Before the September kickoff, keepers are being set for this calendar year.
  return now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const secret =
      searchParams.get('secret') ??
      request.headers.get('authorization')?.replace('Bearer ', '');
    if (secret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const year = parseInt(searchParams.get('season') ?? '') || upcomingSeason();
  const dryRun = searchParams.get('dry') === '1';
  const log: string[] = [];
  const warnings: string[] = [];

  if (!hasEspnCredentials()) {
    return NextResponse.json(
      { success: false, error: 'ESPN credentials not configured', log },
      { status: 500 }
    );
  }

  try {
    // ---------------------------------------------------------------
    // 1. Elections from ESPN
    // ---------------------------------------------------------------
    const { elections, keeperLimit, deadline, offRoster } = await fetchKeeperElections(year);

    // Last season's final roster decides whether a player keeps his draft
    // status: drafted or traded-for keeps it, dropped-and-re-added resets him
    // to a free agent.
    const priorRosters = await fetchFinalRosters(year - 1);
    log.push(`ESPN returned ${elections.length} keeper elections for ${year} (limit ${keeperLimit}/team)`);
    if (deadline) log.push(`Keeper deadline: ${deadline.toISOString().slice(0, 10)}`);

    for (const o of offRoster) {
      warnings.push(`ESPN team ${o.espnTeamId} elected player ${o.espnPlayerId}, who is not on their roster — skipped`);
    }

    if (elections.length === 0) {
      return NextResponse.json({
        success: true,
        year,
        synced: 0,
        log: [...log, 'No keeper elections set in ESPN yet — nothing to sync'],
        warnings,
      });
    }

    // ---------------------------------------------------------------
    // 2. Resolve season, owners and players
    // ---------------------------------------------------------------
    const { data: season } = await supabase
      .from('seasons')
      .select('id, draft_status')
      .eq('year', year)
      .single();

    if (!season) {
      return NextResponse.json(
        { success: false, error: `No season row for ${year}`, log },
        { status: 404 }
      );
    }
    if (season.draft_status === 'drafting' || season.draft_status === 'complete') {
      return NextResponse.json(
        { success: false, error: `Draft for ${year} is ${season.draft_status} — refusing to change keepers`, log },
        { status: 400 }
      );
    }

    const { data: owners } = await supabase.from('owners').select('id, name');
    const ownerIdByName = new Map((owners ?? []).map(o => [o.name, o.id]));

    const { data: players } = await supabase
      .from('players')
      .select('id, name, espn_id')
      .in('espn_id', elections.map(e => String(e.espnPlayerId)));
    const playerByEspnId = new Map((players ?? []).map(p => [p.espn_id, p]));

    // ---------------------------------------------------------------
    // 3. Draft history for cost calculation
    // ---------------------------------------------------------------
    const playerIds = (players ?? []).map(p => p.id);
    const { data: seasons } = await supabase.from('seasons').select('id, year');
    const yearBySeasonId = new Map((seasons ?? []).map(s => [s.id, s.year]));

    const { data: picks } = await supabase
      .from('draft_picks')
      .select('season_id, player_id, round, is_keeper, keeper_year')
      .in('player_id', playerIds.length > 0 ? playerIds : [-1]);

    const historyByPlayer = new Map<number, DraftHistoryEntry[]>();
    for (const pick of picks ?? []) {
      const y = yearBySeasonId.get(pick.season_id);
      if (!y) continue;
      if (!historyByPlayer.has(pick.player_id)) historyByPlayer.set(pick.player_id, []);
      historyByPlayer.get(pick.player_id)!.push({
        year: y,
        round: pick.round,
        isKeeper: Boolean(pick.is_keeper),
        keeperYear: pick.keeper_year,
      });
    }

    // ---------------------------------------------------------------
    // 4. Build keeper rows
    // ---------------------------------------------------------------
    interface Prepared {
      ownerName: string;
      ownerId: string;
      playerId: number;
      playerName: string;
      rank: number;
      rankSource: string;
      cost: ReturnType<typeof computeKeeperCost>;
      lastRound: number | null;
      priorAcquisition: string;
    }

    const prepared: Prepared[] = [];

    for (const election of elections) {
      const ownerName = getOwnerForTeam(election.espnTeamId, year);
      const ownerId = ownerName === 'Unknown' ? null : ownerIdByName.get(ownerName);
      if (!ownerId) {
        warnings.push(`No owner for ESPN team ${election.espnTeamId} in ${year} — skipped ${election.playerName}`);
        continue;
      }

      const player = playerByEspnId.get(String(election.espnPlayerId));
      if (!player) {
        warnings.push(`No player row matching ESPN id ${election.espnPlayerId} (${election.playerName}) — skipped`);
        continue;
      }

      const history = historyByPlayer.get(player.id) ?? [];
      const priorEntry = priorRosters.byPlayerId.get(election.espnPlayerId);
      if (!priorEntry) {
        warnings.push(`${election.playerName} (${ownerName}) was not on any ${year - 1} final roster — treated as a free agent`);
      }
      // Picked up off the wire after the trade deadline — not keeper-eligible.
      if (
        priorEntry &&
        !keepsDraftStatus(priorEntry.acquisitionType) &&
        priorRosters.tradeDeadline !== null &&
        priorEntry.acquisitionDate !== null &&
        priorEntry.acquisitionDate > priorRosters.tradeDeadline
      ) {
        const when = new Date(priorEntry.acquisitionDate).toISOString().slice(0, 10);
        const deadline = new Date(priorRosters.tradeDeadline).toISOString().slice(0, 10);
        warnings.push(
          `${election.playerName} (${ownerName}) was picked up ${when}, after the ${year - 1} trade deadline of ${deadline} — not keeper-eligible, but elected in ESPN`
        );
      }

      const cost = computeKeeperCost(history, year, {
        keepsDraftStatus: priorEntry ? keepsDraftStatus(priorEntry.acquisitionType) : false,
      });

      if (!cost.eligible) {
        warnings.push(`${election.playerName} (${ownerName}) is not keeper-eligible: ${cost.reason}`);
        continue;
      }

      prepared.push({
        ownerName,
        ownerId,
        playerId: player.id,
        playerName: player.name,
        rank: election.rank,
        rankSource: election.rankSource,
        cost,
        lastRound: history.length > 0 ? history[history.length - 1].round : null,
        priorAcquisition: priorEntry?.acquisitionType ?? 'NOT_ROSTERED',
      });
    }

    // ---------------------------------------------------------------
    // 4b. Resolve two keepers landing on the same round.
    //     League rule: the higher-ranked player moves up a round.
    // ---------------------------------------------------------------
    const byOwner = new Map<string, Prepared[]>();
    for (const p of prepared) {
      if (!byOwner.has(p.ownerName)) byOwner.set(p.ownerName, []);
      byOwner.get(p.ownerName)!.push(p);
    }

    // A keeper occupies one of its owner's picks, so traded picks constrain
    // which rounds are actually usable.
    const pickTrades = await fetchPickTrades(supabase, year);
    const ownership = buildRoundOwnership(
      (owners ?? []).map(o => o.id),
      pickTrades
    );
    if (pickTrades.length > 0) {
      log.push(`Applied ${pickTrades.length} traded ${year} picks to round ownership`);
    }

    const rows: Record<string, unknown>[] = [];
    const detail: Record<string, unknown>[] = [];

    for (const [ownerName, ownerKeepers] of byOwner) {
      if (ownerKeepers.length > keeperLimit) {
        warnings.push(`${ownerName} has ${ownerKeepers.length} keepers, over the limit of ${keeperLimit}`);
      }

      const picksByRound = ownership.get(ownerKeepers[0].ownerId);

      const resolved = resolveRoundConflicts(
        ownerKeepers.map(k => ({
          playerName: k.playerName,
          baseRound: k.cost.roundCost,
          rank: k.rank,
        })),
        picksByRound
      );

      for (const r of resolved) {
        const k = ownerKeepers.find(x => x.playerName === r.playerName)!;

        if (r.unresolved) {
          warnings.push(`${ownerName}: ${r.playerName} and another keeper both cost round ${r.baseRound}; ${r.playerName} ${r.unresolved}`);
        } else if (r.bumpedFrom !== undefined) {
          const noPick = (picksByRound?.get(r.bumpedFrom) ?? 1) === 0;
          warnings.push(
            noPick
              ? `${ownerName}: ${r.playerName} bumped from round ${r.bumpedFrom} to round ${r.finalRound} (round ${r.bumpedFrom} pick was traded away)`
              : `${ownerName}: ${r.playerName} bumped from round ${r.bumpedFrom} to round ${r.finalRound} (outranks the other round-${r.bumpedFrom} keeper, ${k.rankSource} rank ${k.rank})`
          );
        }

        rows.push({
          season_id: season.id,
          owner_id: k.ownerId,
          player_id: k.playerId,
          keeper_year: k.cost.keeperYear,
          round_cost: r.finalRound,
          original_draft_round: k.lastRound,
          source_type: k.cost.sourceType,
        });

        detail.push({
          owner: ownerName,
          player: k.playerName,
          keeper_year: `K${k.cost.keeperYear}`,
          round_cost: r.finalRound,
          source: k.cost.sourceType,
          acquired: k.priorAcquisition,
          basis: r.bumpedFrom !== undefined
            ? `${k.cost.basis}, bumped to round ${r.finalRound} (round ${r.bumpedFrom} conflict)`
            : k.cost.basis,
          ...(r.unresolved ? { conflict: r.unresolved } : {}),
        });
      }

      if (picksByRound) {
        const traded = pickTrades.some(
          t => t.fromOwnerId === ownerKeepers[0].ownerId || t.toOwnerId === ownerKeepers[0].ownerId
        );
        if (traded) log.push(`${ownerName} holds ${describeOwnership(picksByRound)}`);
      }
    }

    log.push(`Prepared ${rows.length} keeper rows across ${byOwner.size} owners`);

    if (dryRun) {
      return NextResponse.json({
        success: true, year, dryRun: true, wouldSync: rows.length, log, warnings, detail,
      });
    }

    // ---------------------------------------------------------------
    // 5. Replace this season's keepers — ESPN is authoritative
    // ---------------------------------------------------------------
    const { error: deleteError } = await supabase
      .from('keepers')
      .delete()
      .eq('season_id', season.id);
    if (deleteError) throw new Error(`Clearing keepers failed: ${deleteError.message}`);

    const { error: insertError } = await supabase.from('keepers').insert(rows);
    if (insertError) throw new Error(`Inserting keepers failed: ${insertError.message}`);

    log.push(`Synced ${rows.length} keepers for ${year}`);

    return NextResponse.json({
      // The sync itself succeeded; warnings are advisory (e.g. two keepers
      // landing on the same round) and need a human, not a retry.
      success: true,
      hasWarnings: warnings.length > 0,
      year,
      synced: rows.length,
      log,
      warnings,
      detail,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    log.push(`ERROR: ${err.message}`);
    if (err.message?.includes('401') || err.message?.includes('403')) {
      log.push('ESPN cookies have likely expired — update ESPN_S2 in Vercel env vars');
    }
    return NextResponse.json({ success: false, error: err.message, log, warnings }, { status: 500 });
  }
}
