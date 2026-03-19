"use client";

import { useState, useMemo } from "react";
import type { DraftPick, Owner } from "@/types/database";
import { formatPickLabel } from "@/lib/draft/snake-order";

interface TradeModalProps {
  owners: Owner[];
  currentOwnerId: string;
  picks: DraftPick[];
  seasonId: number;
  onClose: () => void;
}

export function TradeModal({
  owners,
  currentOwnerId,
  picks,
  seasonId,
  onClose,
}: TradeModalProps) {
  const [tradingWith, setTradingWith] = useState<string>("");
  const [givingPicks, setGivingPicks] = useState<Set<number>>(new Set());
  const [receivingPicks, setReceivingPicks] = useState<Set<number>>(new Set());
  const [includeFuture, setIncludeFuture] = useState(false);
  const [futureGiving, setFutureGiving] = useState<{ year: number; round: number }[]>([]);
  const [futureReceiving, setFutureReceiving] = useState<{ year: number; round: number }[]>([]);
  const [notes, setNotes] = useState("");

  const otherOwners = owners.filter((o) => o.id !== currentOwnerId);

  // My undrafted picks
  const myPicks = useMemo(
    () =>
      picks.filter(
        (p) => p.current_owner_id === currentOwnerId && p.player_id === null
      ),
    [picks, currentOwnerId]
  );

  // Partner's undrafted picks
  const partnerPicks = useMemo(
    () =>
      tradingWith
        ? picks.filter(
            (p) => p.current_owner_id === tradingWith && p.player_id === null
          )
        : [],
    [picks, tradingWith]
  );

  const togglePick = (
    pickId: number,
    set: Set<number>,
    setter: (s: Set<number>) => void
  ) => {
    const next = new Set(set);
    if (next.has(pickId)) {
      next.delete(pickId);
    } else {
      next.add(pickId);
    }
    setter(next);
  };

  const canSubmit =
    tradingWith &&
    (givingPicks.size > 0 || futureGiving.length > 0) &&
    (receivingPicks.size > 0 || futureReceiving.length > 0);

  const handleSubmit = () => {
    if (!canSubmit) return;

    // TODO: POST to /api/trades/propose
    console.log("Trade proposed:", {
      seasonId,
      proposerId: currentOwnerId,
      accepterId: tradingWith,
      givingPicks: Array.from(givingPicks),
      receivingPicks: Array.from(receivingPicks),
      futureGiving,
      futureReceiving,
      notes,
    });

    onClose();
  };

  const partnerOwner = owners.find((o) => o.id === tradingWith);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
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
            <label className="block text-sm font-medium mb-1">Trade with</label>
            <select
              value={tradingWith}
              onChange={(e) => {
                setTradingWith(e.target.value);
                setReceivingPicks(new Set());
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
            >
              <option value="">Select a team...</option>
              {otherOwners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.team_name}
                </option>
              ))}
            </select>
          </div>

          {tradingWith && (
            <div className="grid grid-cols-2 gap-4">
              {/* Your picks to give */}
              <div>
                <h4 className="text-sm font-semibold text-danger mb-2">
                  You Give
                </h4>
                <div className="space-y-1">
                  {myPicks.map((pick) => (
                    <label
                      key={pick.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
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
                      <span className="text-sm">
                        Rd {pick.round}, Pick {pick.pick_in_round}
                        <span className="text-muted ml-1 text-xs font-mono">
                          ({formatPickLabel(pick.round, pick.pick_in_round)})
                        </span>
                      </span>
                    </label>
                  ))}
                  {myPicks.length === 0 && (
                    <p className="text-xs text-muted p-2">
                      No undrafted picks available
                    </p>
                  )}
                </div>
              </div>

              {/* Partner's picks to receive */}
              <div>
                <h4 className="text-sm font-semibold text-accent mb-2">
                  You Receive
                </h4>
                <div className="space-y-1">
                  {partnerPicks.map((pick) => (
                    <label
                      key={pick.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
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
                      <span className="text-sm">
                        Rd {pick.round}, Pick {pick.pick_in_round}
                        <span className="text-muted ml-1 text-xs font-mono">
                          ({formatPickLabel(pick.round, pick.pick_in_round)})
                        </span>
                      </span>
                    </label>
                  ))}
                  {partnerPicks.length === 0 && (
                    <p className="text-xs text-muted p-2">
                      No undrafted picks available
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Future picks toggle */}
          {tradingWith && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeFuture}
                  onChange={(e) => setIncludeFuture(e.target.checked)}
                  className="accent-accent"
                />
                Include future draft picks
              </label>
              {includeFuture && (
                <p className="text-xs text-muted mt-1">
                  Future pick trading UI coming soon — describe in notes below
                  for now.
                </p>
              )}
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
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent resize-none h-20"
              />
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
          {tradingWith && (
            <div className="text-xs text-muted">
              {givingPicks.size} pick{givingPicks.size !== 1 ? "s" : ""} out,{" "}
              {receivingPicks.size} pick{receivingPicks.size !== 1 ? "s" : ""}{" "}
              in
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              canSubmit
                ? "bg-accent text-background hover:bg-accent-hover"
                : "bg-border text-muted cursor-not-allowed"
            }`}
          >
            Propose Trade
          </button>
        </div>
      </div>
    </div>
  );
}
