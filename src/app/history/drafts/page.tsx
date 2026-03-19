import { createClient } from "@/lib/supabase/server";

export default async function DraftHistoryIndex() {
  const supabase = await createClient();

  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, year")
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
      <div>
        <a href="/history" className="text-xs text-muted hover:text-accent">← League History</a>
        <h1 className="text-3xl font-bold mt-2">Draft History</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {(seasons ?? [])
          .filter((s) => (countMap.get(s.id) ?? 0) > 0)
          .map((s) => (
            <a
              key={s.id}
              href={`/history/drafts/${s.year}`}
              className="block bg-card border border-border rounded-xl p-4 hover:bg-card-hover hover:-translate-y-0.5 transition-all text-center"
            >
              <div className="text-2xl font-black">{s.year}</div>
              <div className="text-xs text-muted mt-1">
                {countMap.get(s.id) ?? 0} picks
              </div>
            </a>
          ))}
      </div>
    </div>
  );
}
