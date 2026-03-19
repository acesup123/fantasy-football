"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { createClient } from "@/lib/supabase/client";
import type {
  Trade,
  TradeAsset,
  Owner,
  Season,
  DraftPick,
} from "@/types/database";
import { LEAGUE_CONFIG } from "@/types/database";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface TradeRow extends Trade {
  proposer: Owner;
  accepter: Owner;
  trade_assets: (TradeAsset & {
    draft_pick?: DraftPick | null;
    player?: { id: number; name: string; position: string } | null;
  })[];
  trade_conditions: { id: number; description: string; is_met: boolean }[];
}

interface FuturePickEntry {
  year: number;
  round: number;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const STATUS_STYLES: Record<string, string> = {
  pending: "text-warning bg-warning/10",
  accepted: "text-accent bg-accent/10",
  declined: "text-danger bg-danger/10",
  cancelled: "text-muted bg-muted/10",
  voided: "text-muted bg-muted/10",
};

const CONTEXT_LABELS: Record<string, string> = {
  draft: "Draft Day",
  in_season: "In-Season",
  offseason: "Offseason",
};

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  DEF: "pos-def",
};

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function TradesPage() {
  const supabase = createClient();
  const { owner, loading: authLoading } = useAuth();

  const [owners, setOwners] = useState<Owner[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [draftPicks, setDraftPicks] = useState<DraftPick[]>([]);
  const [pickSeasonId, setPickSeasonId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasonFilter, setSeasonFilter] = useState<number | "all">("all");
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  /* ─── Data loading ──────────────────────────────────────────────── */

  const loadData = useCallback(async () => {
    setLoading(true);

    const [ownersRes, seasonsRes, tradesRes] = await Promise.all([
      supabase.from("owners").select("*").eq("is_active", true).order("name"),
      supabase.from("seasons").select("*").order("year", { ascending: false }),
      supabase
        .from("trades")
        .select(
          `*, proposer:owners!trades_proposer_id_fkey(*), accepter:owners!trades_accepter_id_fkey(*), trade_assets(*, draft_pick:draft_picks(*), player:players(id, name, position)), trade_conditions(*)`
        )
        .order("proposed_at", { ascending: false }),
    ]);

    if (ownersRes.data) setOwners(ownersRes.data);
    if (seasonsRes.data) setSeasons(seasonsRes.data);
    if (tradesRes.data) setTrades(tradesRes.data as unknown as TradeRow[]);

    // Load draft picks for the most recent season that has them
    if (seasonsRes.data && seasonsRes.data.length > 0) {
      for (const s of seasonsRes.data) {
        const { data: picks, count } = await supabase
          .from("draft_picks")
          .select("*", { count: "exact" })
          .eq("season_id", s.id)
          .order("overall_pick");

        if (count && count > 0 && picks) {
          setDraftPicks(picks);
          setPickSeasonId(s.id);
          break;
        }
      }
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ─── Derived data ──────────────────────────────────────────────── */

  const pendingTrades = useMemo(
    () =>
      trades.filter(
        (t) =>
          t.status === "pending" &&
          owner &&
          (t.proposer_id === owner.id || t.accepter_id === owner.id)
      ),
    [trades, owner]
  );

  const historyTrades = useMemo(() => {
    let filtered = trades.filter((t) => t.status !== "pending");
    if (seasonFilter !== "all") {
      filtered = filtered.filter((t) => t.season_id === seasonFilter);
    }
    return filtered;
  }, [trades, seasonFilter]);

  const pickSeason = seasons.find((s) => s.id === pickSeasonId);

  /* ─── Actions ───────────────────────────────────────────────────── */

  const respondToTrade = async (
    tradeId: number,
    action: "accept" | "decline" | "cancel"
  ) => {
    if (!owner) return;
    setActionLoading(tradeId);

    const resp = await fetch("/api/trades/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trade_id: tradeId,
        owner_id: owner.id,
        action,
      }),
    });

    const result = await resp.json();
    if (result.success) {
      showToast(
        `Trade ${action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled"}`
      );
      await loadData();
    } else {
      showToast(`Error: ${result.error}`);
    }

    setActionLoading(null);
  };

  /* ─── Loading state ─────────────────────────────────────────────── */

  if (loading || authLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Trade Center</h1>
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-xl h-28 shimmer"
            />
          ))}
        </div>
      </div>
    );
  }

  /* ─── Render ────────────────────────────────────────────────────── */

  return (
    <div className="space-y-8">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-accent text-background px-4 py-2 rounded-lg text-sm font-medium shadow-lg fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Trade Center</h1>
          <p className="text-muted text-sm">
            Propose trades, view history, and track draft pick ownership
          </p>
        </div>
        {owner && (
          <button
            onClick={() => setShowProposalForm(true)}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            New Trade
          </button>
        )}
      </div>

      {/* New Trade Modal */}
      {showProposalForm && owner && (
        <TradeProposalModal
          owners={owners}
          currentOwner={owner}
          seasons={seasons}
          draftPicks={draftPicks}
          pickSeasonId={pickSeasonId}
          onClose={() => setShowProposalForm(false)}
          onSuccess={() => {
            setShowProposalForm(false);
            showToast("Trade proposed!");
            loadData();
          }}
        />
      )}

      {/* Pending Trades */}
      {owner && pendingTrades.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">
            Pending Trades
            <span className="ml-2 text-xs text-warning font-normal bg-warning/10 px-2 py-0.5 rounded">
              {pendingTrades.length}
            </span>
          </h2>
          <div className="space-y-3">
            {pendingTrades.map((trade) => (
              <TradeCard
                key={trade.id}
                trade={trade}
                currentOwnerId={owner.id}
                actionLoading={actionLoading === trade.id}
                onRespond={(action) => respondToTrade(trade.id, action)}
              />
            ))}
          </div>
        </section>
      )}

      {owner && pendingTrades.length === 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Pending Trades</h2>
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted text-sm">
            No pending trades
          </div>
        </section>
      )}

      {/* Trade History */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">Trade History</h2>
          <select
            value={seasonFilter}
            onChange={(e) =>
              setSeasonFilter(
                e.target.value === "all" ? "all" : parseInt(e.target.value)
              )
            }
            className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
          >
            <option value="all">All Seasons</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.year}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-3">
          {historyTrades.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-6 text-center text-muted text-sm">
              No completed trades
              {seasonFilter !== "all" ? " for this season" : ""}
            </div>
          )}
          {historyTrades.map((trade) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              currentOwnerId={owner?.id ?? null}
              actionLoading={false}
              onRespond={() => {}}
            />
          ))}
        </div>
      </section>

      {/* Draft Pick Ownership */}
      {pickSeason && draftPicks.length > 0 && (
        <PickOwnershipTable
          picks={draftPicks}
          owners={owners}
          season={pickSeason}
        />
      )}
    </div>
  );
}

/* ─── Trade Card ────────────────────────────────────────────────────── */

function TradeCard({
  trade,
  currentOwnerId,
  actionLoading,
  onRespond,
}: {
  trade: TradeRow;
  currentOwnerId: string | null;
  actionLoading: boolean;
  onRespond: (action: "accept" | "decline" | "cancel") => void;
}) {
  const proposerAssets = trade.trade_assets.filter(
    (a) => a.from_owner_id === trade.proposer_id
  );
  const accepterAssets = trade.trade_assets.filter(
    (a) => a.from_owner_id === trade.accepter_id
  );

  const isIncoming =
    trade.status === "pending" && trade.accepter_id === currentOwnerId;
  const isOutgoing =
    trade.status === "pending" && trade.proposer_id === currentOwnerId;

  return (
    <div
      className={`bg-card border rounded-xl p-4 ${
        trade.status === "pending" && (isIncoming || isOutgoing)
          ? "border-warning/40"
          : "border-border"
      }`}
    >
      {/* Top row: date, context, status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {new Date(trade.proposed_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="text-xs text-muted bg-background px-2 py-0.5 rounded">
            {CONTEXT_LABELS[trade.context] ?? trade.context}
          </span>
          {isIncoming && (
            <span className="text-[10px] font-bold text-warning bg-warning/10 px-2 py-0.5 rounded">
              INCOMING
            </span>
          )}
          {isOutgoing && (
            <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">
              SENT
            </span>
          )}
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            STATUS_STYLES[trade.status] ?? "text-muted bg-background"
          }`}
        >
          {trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}
        </span>
      </div>

      {/* Trade content */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <div>
          <div className="text-sm font-semibold mb-1.5">
            {trade.proposer?.team_name ?? "Unknown"}
          </div>
          <div className="space-y-1">
            {proposerAssets.map((a) => (
              <AssetPill key={a.id} asset={a} side="give" />
            ))}
          </div>
        </div>

        <div className="text-muted text-lg mt-2">⇄</div>

        <div className="text-right">
          <div className="text-sm font-semibold mb-1.5">
            {trade.accepter?.team_name ?? "Unknown"}
          </div>
          <div className="space-y-1 flex flex-col items-end">
            {accepterAssets.map((a) => (
              <AssetPill key={a.id} asset={a} side="receive" />
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      {trade.notes && (
        <div className="mt-3 text-xs text-muted bg-background rounded px-3 py-2">
          {trade.notes}
        </div>
      )}

      {/* Conditions */}
      {trade.trade_conditions && trade.trade_conditions.length > 0 && (
        <div className="mt-2 text-xs text-warning bg-warning/5 rounded px-3 py-2">
          <span className="font-semibold">Conditions:</span>{" "}
          {trade.trade_conditions.map((c) => c.description).join("; ")}
        </div>
      )}

      {/* Action buttons */}
      {trade.status === "pending" && currentOwnerId && (
        <div className="mt-3 flex items-center gap-2 justify-end">
          {isIncoming && (
            <>
              <button
                onClick={() => onRespond("accept")}
                disabled={actionLoading}
                className="btn-primary text-xs px-4 py-1.5"
              >
                {actionLoading ? "..." : "Accept"}
              </button>
              <button
                onClick={() => onRespond("decline")}
                disabled={actionLoading}
                className="btn-danger text-xs px-4 py-1.5"
              >
                Decline
              </button>
            </>
          )}
          {isOutgoing && (
            <button
              onClick={() => onRespond("cancel")}
              disabled={actionLoading}
              className="btn-secondary text-xs px-4 py-1.5"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Asset Pill ────────────────────────────────────────────────────── */

function AssetPill({
  asset,
  side,
}: {
  asset: TradeRow["trade_assets"][number];
  side: "give" | "receive";
}) {
  const color = side === "give" ? "text-danger" : "text-accent";

  if (asset.asset_type === "draft_pick" && asset.draft_pick) {
    return (
      <span className={`text-xs ${color}`}>
        Rd {asset.draft_pick.round}, Pick {asset.draft_pick.pick_in_round}
        <span className="text-muted ml-1 text-[10px]">
          (#{asset.draft_pick.overall_pick})
        </span>
      </span>
    );
  }

  if (asset.asset_type === "player" && asset.player) {
    return (
      <span className={`text-xs ${color} flex items-center gap-1`}>
        <span
          className={`text-[9px] font-black px-1 py-0.5 rounded ${
            POS_BADGE[asset.player.position] ?? ""
          }`}
        >
          {asset.player.position}
        </span>
        {asset.player.name}
      </span>
    );
  }

  if (asset.asset_type === "future_pick") {
    return (
      <span className={`text-xs ${color}`}>
        {asset.future_season_year} Round {asset.future_round} pick
      </span>
    );
  }

  // Fallback to description
  return (
    <span className={`text-xs ${color}`}>{asset.description ?? "Asset"}</span>
  );
}

/* ─── Trade Proposal Modal ──────────────────────────────────────────── */

function TradeProposalModal({
  owners,
  currentOwner,
  seasons,
  draftPicks,
  pickSeasonId,
  onClose,
  onSuccess,
}: {
  owners: Owner[];
  currentOwner: { id: string; name: string; team_name: string };
  seasons: Season[];
  draftPicks: DraftPick[];
  pickSeasonId: number | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tradingWith, setTradingWith] = useState("");
  const [givingPicks, setGivingPicks] = useState<Set<number>>(new Set());
  const [receivingPicks, setReceivingPicks] = useState<Set<number>>(new Set());
  const [givingFuture, setGivingFuture] = useState<FuturePickEntry[]>([]);
  const [receivingFuture, setReceivingFuture] = useState<FuturePickEntry[]>(
    []
  );
  const [givingDescriptions, setGivingDescriptions] = useState<string[]>([]);
  const [receivingDescriptions, setReceivingDescriptions] = useState<string[]>(
    []
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherOwners = owners.filter((o) => o.id !== currentOwner.id);

  const currentSeason = seasons.find((s) => s.is_current) ?? seasons[0];
  const currentYear = currentSeason?.year ?? new Date().getFullYear();

  // My undrafted picks for current season
  const myPicks = useMemo(
    () =>
      draftPicks.filter(
        (p) =>
          p.current_owner_id === currentOwner.id && p.player_id === null
      ),
    [draftPicks, currentOwner.id]
  );

  // Partner undrafted picks
  const partnerPicks = useMemo(
    () =>
      tradingWith
        ? draftPicks.filter(
            (p) => p.current_owner_id === tradingWith && p.player_id === null
          )
        : [],
    [draftPicks, tradingWith]
  );

  const togglePick = (
    pickId: number,
    set: Set<number>,
    setter: (s: Set<number>) => void
  ) => {
    const next = new Set(set);
    if (next.has(pickId)) next.delete(pickId);
    else next.add(pickId);
    setter(next);
  };

  const addFuture = (
    list: FuturePickEntry[],
    setter: (l: FuturePickEntry[]) => void
  ) => {
    setter([...list, { year: currentYear + 1, round: 1 }]);
  };

  const updateFuture = (
    list: FuturePickEntry[],
    setter: (l: FuturePickEntry[]) => void,
    idx: number,
    field: "year" | "round",
    value: number
  ) => {
    const next = [...list];
    next[idx] = { ...next[idx], [field]: value };
    setter(next);
  };

  const removeFuture = (
    list: FuturePickEntry[],
    setter: (l: FuturePickEntry[]) => void,
    idx: number
  ) => {
    setter(list.filter((_, i) => i !== idx));
  };

  const addDescription = (
    list: string[],
    setter: (l: string[]) => void
  ) => {
    setter([...list, ""]);
  };

  const updateDescription = (
    list: string[],
    setter: (l: string[]) => void,
    idx: number,
    value: string
  ) => {
    const next = [...list];
    next[idx] = value;
    setter(next);
  };

  const removeDescription = (
    list: string[],
    setter: (l: string[]) => void,
    idx: number
  ) => {
    setter(list.filter((_, i) => i !== idx));
  };

  const hasGiving =
    givingPicks.size > 0 ||
    givingFuture.length > 0 ||
    givingDescriptions.filter((d) => d.trim()).length > 0;
  const hasReceiving =
    receivingPicks.size > 0 ||
    receivingFuture.length > 0 ||
    receivingDescriptions.filter((d) => d.trim()).length > 0;
  const canSubmit = tradingWith && hasGiving && hasReceiving && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !currentSeason) return;
    setSubmitting(true);
    setError(null);

    // Build assets array
    const assets: any[] = [];

    // Current-season draft picks I'm giving
    for (const pickId of givingPicks) {
      assets.push({
        from_owner_id: currentOwner.id,
        to_owner_id: tradingWith,
        asset_type: "draft_pick",
        draft_pick_id: pickId,
      });
    }

    // Current-season draft picks I'm receiving
    for (const pickId of receivingPicks) {
      assets.push({
        from_owner_id: tradingWith,
        to_owner_id: currentOwner.id,
        asset_type: "draft_pick",
        draft_pick_id: pickId,
      });
    }

    // Future picks I'm giving
    for (const fp of givingFuture) {
      assets.push({
        from_owner_id: currentOwner.id,
        to_owner_id: tradingWith,
        asset_type: "future_pick",
        future_season_year: fp.year,
        future_round: fp.round,
        description: `${fp.year} Round ${fp.round} pick`,
      });
    }

    // Future picks I'm receiving
    for (const fp of receivingFuture) {
      assets.push({
        from_owner_id: tradingWith,
        to_owner_id: currentOwner.id,
        asset_type: "future_pick",
        future_season_year: fp.year,
        future_round: fp.round,
        description: `${fp.year} Round ${fp.round} pick`,
      });
    }

    // Text-described assets (players, etc.) I'm giving
    for (const desc of givingDescriptions) {
      if (desc.trim()) {
        assets.push({
          from_owner_id: currentOwner.id,
          to_owner_id: tradingWith,
          asset_type: "player",
          description: desc.trim(),
        });
      }
    }

    // Text-described assets I'm receiving
    for (const desc of receivingDescriptions) {
      if (desc.trim()) {
        assets.push({
          from_owner_id: tradingWith,
          to_owner_id: currentOwner.id,
          asset_type: "player",
          description: desc.trim(),
        });
      }
    }

    const resp = await fetch("/api/trades/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season_id: currentSeason.id,
        proposer_id: currentOwner.id,
        accepter_id: tradingWith,
        context: "offseason",
        notes: notes.trim() || null,
        assets,
      }),
    });

    const result = await resp.json();
    setSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? "Failed to propose trade");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">Propose a Trade</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Select trade partner */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Trade with
            </label>
            <select
              value={tradingWith}
              onChange={(e) => {
                setTradingWith(e.target.value);
                setReceivingPicks(new Set());
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
            >
              <option value="">Select a team...</option>
              {otherOwners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.team_name} ({o.name})
                </option>
              ))}
            </select>
          </div>

          {tradingWith && (
            <div className="grid grid-cols-2 gap-4">
              {/* You Give */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-danger">You Give</h4>

                {/* Current-season draft picks */}
                {myPicks.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-1">
                      {currentYear} Draft Picks
                    </p>
                    <div className="space-y-1">
                      {myPicks.map((pick) => (
                        <label
                          key={pick.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-sm ${
                            givingPicks.has(pick.id)
                              ? "bg-danger/20 border border-danger/40"
                              : "bg-background hover:bg-card-hover border border-transparent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={givingPicks.has(pick.id)}
                            onChange={() =>
                              togglePick(pick.id, givingPicks, setGivingPicks)
                            }
                            className="accent-danger"
                          />
                          Rd {pick.round}, Pick {pick.pick_in_round}
                          <span className="text-muted text-xs">
                            (#{pick.overall_pick})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Future picks */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                      Future Picks
                    </p>
                    <button
                      onClick={() => addFuture(givingFuture, setGivingFuture)}
                      className="text-[10px] text-accent hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                  {givingFuture.map((fp, i) => (
                    <FuturePickRow
                      key={i}
                      entry={fp}
                      currentYear={currentYear}
                      onChange={(field, val) =>
                        updateFuture(
                          givingFuture,
                          setGivingFuture,
                          i,
                          field,
                          val
                        )
                      }
                      onRemove={() =>
                        removeFuture(givingFuture, setGivingFuture, i)
                      }
                    />
                  ))}
                </div>

                {/* Player descriptions */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                      Players / Other
                    </p>
                    <button
                      onClick={() =>
                        addDescription(
                          givingDescriptions,
                          setGivingDescriptions
                        )
                      }
                      className="text-[10px] text-accent hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                  {givingDescriptions.map((desc, i) => (
                    <div key={i} className="flex items-center gap-1 mb-1">
                      <input
                        type="text"
                        value={desc}
                        onChange={(e) =>
                          updateDescription(
                            givingDescriptions,
                            setGivingDescriptions,
                            i,
                            e.target.value
                          )
                        }
                        placeholder="e.g. Patrick Mahomes (QB, KC)"
                        className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-xs focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() =>
                          removeDescription(
                            givingDescriptions,
                            setGivingDescriptions,
                            i
                          )
                        }
                        className="text-danger text-xs hover:underline px-1"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* You Receive */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-accent">
                  You Receive
                </h4>

                {/* Partner current-season draft picks */}
                {partnerPicks.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-1">
                      {currentYear} Draft Picks
                    </p>
                    <div className="space-y-1">
                      {partnerPicks.map((pick) => (
                        <label
                          key={pick.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-sm ${
                            receivingPicks.has(pick.id)
                              ? "bg-accent/20 border border-accent/40"
                              : "bg-background hover:bg-card-hover border border-transparent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={receivingPicks.has(pick.id)}
                            onChange={() =>
                              togglePick(
                                pick.id,
                                receivingPicks,
                                setReceivingPicks
                              )
                            }
                            className="accent-accent"
                          />
                          Rd {pick.round}, Pick {pick.pick_in_round}
                          <span className="text-muted text-xs">
                            (#{pick.overall_pick})
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Future picks */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                      Future Picks
                    </p>
                    <button
                      onClick={() =>
                        addFuture(receivingFuture, setReceivingFuture)
                      }
                      className="text-[10px] text-accent hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                  {receivingFuture.map((fp, i) => (
                    <FuturePickRow
                      key={i}
                      entry={fp}
                      currentYear={currentYear}
                      onChange={(field, val) =>
                        updateFuture(
                          receivingFuture,
                          setReceivingFuture,
                          i,
                          field,
                          val
                        )
                      }
                      onRemove={() =>
                        removeFuture(receivingFuture, setReceivingFuture, i)
                      }
                    />
                  ))}
                </div>

                {/* Player descriptions */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                      Players / Other
                    </p>
                    <button
                      onClick={() =>
                        addDescription(
                          receivingDescriptions,
                          setReceivingDescriptions
                        )
                      }
                      className="text-[10px] text-accent hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                  {receivingDescriptions.map((desc, i) => (
                    <div key={i} className="flex items-center gap-1 mb-1">
                      <input
                        type="text"
                        value={desc}
                        onChange={(e) =>
                          updateDescription(
                            receivingDescriptions,
                            setReceivingDescriptions,
                            i,
                            e.target.value
                          )
                        }
                        placeholder="e.g. Josh Allen (QB, BUF)"
                        className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-xs focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() =>
                          removeDescription(
                            receivingDescriptions,
                            setReceivingDescriptions,
                            i
                          )
                        }
                        className="text-danger text-xs hover:underline px-1"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {tradingWith && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Notes / Conditions
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any conditions or notes about this trade..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent resize-none h-20"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-danger bg-danger/10 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              canSubmit
                ? "btn-primary"
                : "bg-border text-muted cursor-not-allowed"
            }`}
          >
            {submitting ? "Submitting..." : "Propose Trade"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Future Pick Row ───────────────────────────────────────────────── */

function FuturePickRow({
  entry,
  currentYear,
  onChange,
  onRemove,
}: {
  entry: FuturePickEntry;
  currentYear: number;
  onChange: (field: "year" | "round", value: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1 mb-1">
      <select
        value={entry.year}
        onChange={(e) => onChange("year", parseInt(e.target.value))}
        className="px-2 py-1.5 bg-background border border-border rounded text-xs focus:outline-none focus:border-accent"
      >
        {[1, 2, 3].map((offset) => (
          <option key={offset} value={currentYear + offset}>
            {currentYear + offset}
          </option>
        ))}
      </select>
      <select
        value={entry.round}
        onChange={(e) => onChange("round", parseInt(e.target.value))}
        className="px-2 py-1.5 bg-background border border-border rounded text-xs focus:outline-none focus:border-accent"
      >
        {Array.from({ length: LEAGUE_CONFIG.NUM_ROUNDS }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            Round {i + 1}
          </option>
        ))}
      </select>
      <button
        onClick={onRemove}
        className="text-danger text-xs hover:underline px-1"
      >
        &times;
      </button>
    </div>
  );
}

/* ─── Pick Ownership Table ──────────────────────────────────────────── */

function PickOwnershipTable({
  picks,
  owners,
  season,
}: {
  picks: DraftPick[];
  owners: Owner[];
  season: Season;
}) {
  const ownerMap = useMemo(() => {
    const m = new Map<string, Owner>();
    for (const o of owners) m.set(o.id, o);
    return m;
  }, [owners]);

  // Group picks by round
  const rounds = useMemo(() => {
    const map = new Map<number, DraftPick[]>();
    for (const p of picks) {
      if (!map.has(p.round)) map.set(p.round, []);
      map.get(p.round)!.push(p);
    }
    // Sort picks within each round by pick_in_round
    for (const [, roundPicks] of map) {
      roundPicks.sort((a, b) => a.pick_in_round - b.pick_in_round);
    }
    return map;
  }, [picks]);

  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b);
  const numSlots = Math.max(
    ...Array.from(rounds.values()).map((r) => r.length),
    LEAGUE_CONFIG.NUM_TEAMS
  );

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">
        Draft Pick Ownership — {season.year}
      </h2>
      <p className="text-muted text-sm mb-3">
        Highlighted picks have been traded from their original owner.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-muted font-semibold border-b border-border sticky left-0 bg-background">
                Round
              </th>
              {Array.from({ length: numSlots }, (_, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 text-muted font-semibold border-b border-border text-center min-w-[80px]"
                >
                  Pick {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roundNumbers.map((round) => {
              const roundPicks = rounds.get(round) ?? [];
              return (
                <tr key={round}>
                  <td className="px-2 py-1.5 font-bold text-muted border-b border-border/30 sticky left-0 bg-background">
                    Rd {round}
                  </td>
                  {Array.from({ length: numSlots }, (_, slotIdx) => {
                    const pick = roundPicks[slotIdx];
                    if (!pick) {
                      return (
                        <td
                          key={slotIdx}
                          className="px-2 py-1.5 border-b border-border/30 text-center"
                        >
                          —
                        </td>
                      );
                    }

                    const currentOwner = ownerMap.get(pick.current_owner_id);
                    const originalOwner = ownerMap.get(pick.original_owner_id);
                    const isTraded =
                      pick.current_owner_id !== pick.original_owner_id;

                    return (
                      <td
                        key={slotIdx}
                        className={`px-2 py-1.5 border-b border-border/30 text-center ${
                          isTraded
                            ? "bg-warning/10 border-l border-r border-warning/30"
                            : ""
                        }`}
                      >
                        <div className="font-semibold truncate">
                          {currentOwner?.name?.split(" ")[0] ??
                            currentOwner?.team_name ??
                            "—"}
                        </div>
                        {isTraded && originalOwner && (
                          <div className="text-[9px] text-muted line-through truncate">
                            {originalOwner.name?.split(" ")[0] ??
                              originalOwner.team_name}
                          </div>
                        )}
                        {pick.player_id !== null && (
                          <div className="text-[9px] text-accent truncate">
                            Picked
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
