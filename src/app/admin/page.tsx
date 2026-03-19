"use client";

import { useState } from "react";

export default function AdminPage() {
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const runSync = async () => {
    setSyncing(true);
    setSyncStatus("Syncing...");
    try {
      const resp = await fetch("/api/sync");
      const result = await resp.json();
      if (result.success) {
        setSyncStatus(`Synced ${result.year} season. ${result.log?.slice(-1)?.[0] ?? "Done!"}`);
      } else {
        setSyncStatus(`Error: ${result.error ?? result.log?.slice(-1)?.[0] ?? "Unknown error"}`);
      }
    } catch (err) {
      setSyncStatus("Failed to reach sync endpoint");
    }
    setSyncing(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League Admin</h1>

      {/* Draft Lottery — featured */}
      <a
        href="/admin/lottery"
        className="block bg-card border border-accent/30 rounded-xl p-5 hover:bg-card-hover hover:-translate-y-0.5 transition-all group"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-black text-lg text-accent group-hover:underline">
              Draft Order Lottery
            </h2>
            <p className="text-xs text-muted mt-1">
              Run the weighted lottery to determine 2026 draft order. Top 4 locked in reverse, bottom 8 enter the draw.
            </p>
          </div>
          <span className="text-3xl">🎰</span>
        </div>
      </a>

      {/* ESPN Sync */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm">ESPN Auto-Sync</h2>
            <p className="text-xs text-muted mt-0.5">
              Runs daily at 8am UTC. Syncs standings, matchups, and playoff results.
            </p>
            {syncStatus && (
              <p className={`text-xs mt-1 ${syncStatus.includes("Error") || syncStatus.includes("Failed") ? "text-danger" : "text-accent"}`}>
                {syncStatus}
              </p>
            )}
          </div>
          <button
            onClick={runSync}
            disabled={syncing}
            className={`btn-primary text-xs px-4 py-2 ${syncing ? "opacity-50" : ""}`}
          >
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Season Management */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Season Management</h2>
          <p className="text-xs text-muted">
            Create seasons, set draft order, manage draft status
          </p>
          <div className="space-y-2">
            <button className="w-full py-2 bg-accent text-background rounded text-sm font-medium hover:bg-accent-hover transition-colors">
              Create New Season
            </button>
            <a href="/admin/lottery" className="block w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors text-center">
              Run Draft Lottery
            </a>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Lock Keepers
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Start Draft
            </button>
          </div>
        </div>

        {/* Owner Management */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Owner Management</h2>
          <p className="text-xs text-muted">
            Add/edit league members, manage access
          </p>
          <div className="space-y-2">
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Add Owner
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Edit Owners
            </button>
          </div>
        </div>

        {/* Data Import */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Data Import</h2>
          <p className="text-xs text-muted">
            Import players, season results, and historical data
          </p>
          <div className="space-y-2">
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Import Players (CSV)
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Import from ESPN
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Import Season Results
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Import Draft History
            </button>
          </div>
        </div>

        {/* League Settings */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">League Settings</h2>
          <p className="text-xs text-muted">
            Configure league rules, scoring, roster spots
          </p>
          <div className="space-y-2">
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Edit League Settings
            </button>
            <button className="w-full py-2 bg-background border border-border rounded text-sm hover:bg-card-hover transition-colors">
              Edit Roster Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
