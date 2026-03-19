import { createClient } from "@/lib/supabase/server";

export default async function DraftLobbyPage() {
  const supabase = await createClient();

  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, year, draft_status")
    .order("year", { ascending: false });

  // Count picks per season
  const { data: pickCounts } = await supabase
    .from("draft_picks")
    .select("season_id");

  const countMap = new Map<number, number>();
  for (const p of pickCounts ?? []) {
    countMap.set(p.season_id, (countMap.get(p.season_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Draft Room</h1>
      <p className="text-muted text-sm">Select a season to view or start a draft.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(seasons ?? []).map((season) => {
          const picks = countMap.get(season.id) ?? 0;
          return (
            <DraftSeasonCard
              key={season.id}
              year={season.year}
              status={season.draft_status}
              picks={picks}
            />
          );
        })}
      </div>
    </div>
  );
}

function DraftSeasonCard({
  year,
  status,
  picks,
}: {
  year: number;
  status: string;
  picks: number;
}) {
  const statusColors: Record<string, string> = {
    pending: "text-muted",
    keepers_open: "text-warning",
    keepers_locked: "text-warning",
    drafting: "text-accent",
    complete: "text-wr",
  };

  const statusLabels: Record<string, string> = {
    pending: "Not Started",
    keepers_open: "Keepers Open",
    keepers_locked: "Keepers Locked",
    drafting: "LIVE",
    complete: "Complete",
  };

  return (
    <a
      href={`/draft/${year}`}
      className="block bg-card border border-border rounded-xl p-6 hover:bg-card-hover hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xl font-bold">{year} Draft</h3>
        <span className={`text-xs font-bold uppercase tracking-wider ${statusColors[status] ?? "text-muted"}`}>
          {status === "drafting" && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse mr-1.5" />
          )}
          {statusLabels[status] ?? status}
        </span>
      </div>
      <p className="text-muted text-sm">
        {status === "drafting"
          ? "Draft is live — join now"
          : status === "complete"
          ? `${picks} picks · View draft results`
          : "Set up keepers and draft order"}
      </p>
    </a>
  );
}
