"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const POS_BADGE: Record<string, string> = {
  QB: "pos-qb",
  RB: "pos-rb",
  WR: "pos-wr",
  TE: "pos-te",
  DEF: "pos-def",
  K: "pos-def",
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "DEF"] as const;
const PAGE_SIZE = 50;

interface PlayerRow {
  id: number;
  name: string;
  position: string;
  nfl_team: string | null;
  is_active: boolean;
  draft_count: number;
}

export default function PlayersPage() {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [draftCounts, setDraftCounts] = useState<Map<number, number>>(
    new Map()
  );

  const supabase = createClient();

  // Load draft counts once
  useEffect(() => {
    async function loadDraftCounts() {
      const { data } = await supabase
        .from("draft_picks")
        .select("player_id");

      if (data) {
        const counts = new Map<number, number>();
        for (const row of data) {
          if (row.player_id != null) {
            counts.set(row.player_id, (counts.get(row.player_id) ?? 0) + 1);
          }
        }
        setDraftCounts(counts);
      }
    }
    loadDraftCounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPlayers = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      const offset = reset ? 0 : page * PAGE_SIZE;

      let query = supabase
        .from("players")
        .select("id, name, position, nfl_team, is_active")
        .order("name")
        .range(offset, offset + PAGE_SIZE - 1);

      if (posFilter !== "ALL") {
        query = query.eq("position", posFilter);
      }

      if (search.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }

      const { data } = await query;
      const rows: PlayerRow[] = (data ?? []).map((p) => ({
        ...p,
        draft_count: draftCounts.get(p.id) ?? 0,
      }));

      if (reset) {
        setPlayers(rows);
        setPage(1);
      } else {
        setPlayers((prev) => [...prev, ...rows]);
        setPage((prev) => prev + 1);
      }

      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    },
    [search, posFilter, page, draftCounts, supabase]
  );

  // Reset and reload when filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      loadPlayers(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, posFilter, draftCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <a href="/" className="text-xs text-muted hover:text-accent">
          &larr; Home
        </a>
        <h1 className="text-3xl font-bold mt-2">Players</h1>
        <p className="text-muted text-sm">
          Browse all players in the league database.
        </p>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                posFilter === pos
                  ? "bg-accent text-background"
                  : "bg-card border border-border text-muted hover:text-foreground"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-muted uppercase tracking-wider border-b border-border">
              <th className="text-left px-4 py-2">Player</th>
              <th className="text-center px-3 py-2">Pos</th>
              <th className="text-left px-3 py-2">Team</th>
              <th className="text-center px-3 py-2">Times Drafted</th>
              <th className="text-center px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.id}
                className="border-b border-border/20 hover:bg-card-hover/30"
              >
                <td className="px-4 py-2 text-sm font-semibold">
                  <a
                    href={`/players/${p.id}`}
                    className="hover:text-accent"
                  >
                    {p.name}
                  </a>
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                      POS_BADGE[p.position] ?? ""
                    }`}
                  >
                    {p.position}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm text-muted">
                  {p.nfl_team ?? "FA"}
                </td>
                <td className="px-3 py-2 text-sm text-center font-mono">
                  {p.draft_count || "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      p.is_active
                        ? "bg-accent/20 text-accent"
                        : "bg-danger/20 text-danger"
                    }`}
                  >
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}

            {players.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted text-sm"
                >
                  No players found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="text-center">
          <button
            onClick={() => loadPlayers(false)}
            disabled={loading}
            className="btn-secondary text-sm px-6 py-2"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {loading && players.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-lg h-10 shimmer"
            />
          ))}
        </div>
      )}
    </div>
  );
}
