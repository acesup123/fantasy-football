import { createClient } from "@/lib/supabase/server";

interface Owner {
  id: string;
  name: string;
}

interface Matchup {
  home_owner_id: string;
  away_owner_id: string;
  winner_owner_id: string | null;
}

interface Record {
  wins: number;
  losses: number;
}

export default async function HeadToHeadPage() {
  const supabase = await createClient();

  // 1. Fetch active owners ordered by name
  const { data: ownerRows } = await supabase
    .from("owners")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const owners: Owner[] = (ownerRows ?? []) as Owner[];

  // 2. Fetch ALL matchups with pagination (default limit is 1000)
  let allMatchups: Matchup[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("matchups")
      .select("home_owner_id, away_owner_id, winner_owner_id")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allMatchups.push(...(data as Matchup[]));
    offset += 1000;
  }

  // 3. Build head-to-head records: h2h[rowOwnerId][colOwnerId] = { wins, losses }
  const h2h = new Map<string, Map<string, Record>>();
  const ownerIds = new Set(owners.map((o) => o.id));

  for (const owner of owners) {
    const inner = new Map<string, Record>();
    for (const other of owners) {
      if (other.id !== owner.id) {
        inner.set(other.id, { wins: 0, losses: 0 });
      }
    }
    h2h.set(owner.id, inner);
  }

  for (const m of allMatchups) {
    if (!ownerIds.has(m.home_owner_id) || !ownerIds.has(m.away_owner_id)) continue;
    if (!m.winner_owner_id) continue;

    const homeRec = h2h.get(m.home_owner_id)?.get(m.away_owner_id);
    const awayRec = h2h.get(m.away_owner_id)?.get(m.home_owner_id);
    if (!homeRec || !awayRec) continue;

    if (m.winner_owner_id === m.home_owner_id) {
      homeRec.wins++;
      awayRec.losses++;
    } else if (m.winner_owner_id === m.away_owner_id) {
      homeRec.losses++;
      awayRec.wins++;
    }
  }

  // 4. Compute total record for each owner
  const totals = new Map<string, Record>();
  for (const owner of owners) {
    let totalW = 0;
    let totalL = 0;
    const inner = h2h.get(owner.id);
    if (inner) {
      for (const rec of inner.values()) {
        totalW += rec.wins;
        totalL += rec.losses;
      }
    }
    totals.set(owner.id, { wins: totalW, losses: totalL });
  }

  // Helper: first name or short display name
  const shortName = (name: string) => {
    const parts = name.split(" ");
    if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
    return name;
  };

  return (
    <div className="space-y-6">
      <div>
        <a href="/history" className="text-xs text-accent hover:underline">
          &larr; Back to History
        </a>
        <h1 className="text-2xl font-bold mt-2">Head-to-Head Matrix</h1>
        <p className="text-xs text-muted mt-1">
          All-time records between active owners ({allMatchups.length.toLocaleString()} matchups)
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="min-w-max border-collapse">
          <thead>
            <tr>
              {/* Top-left corner */}
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[10px] text-muted uppercase tracking-wider border-b border-r border-border min-w-[100px]">
                Owner
              </th>
              {owners.map((col) => (
                <th
                  key={col.id}
                  className="px-2 py-2 text-center text-[10px] text-muted uppercase tracking-wider border-b border-border bg-card-elevated/30 min-w-[64px]"
                >
                  {shortName(col.name)}
                </th>
              ))}
              <th className="px-3 py-2 text-center text-[10px] text-muted uppercase tracking-wider border-b border-l border-border bg-card-elevated/30 min-w-[64px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {owners.map((row) => {
              const total = totals.get(row.id) ?? { wins: 0, losses: 0 };
              const totalColor =
                total.wins > total.losses
                  ? "text-accent"
                  : total.wins < total.losses
                    ? "text-danger"
                    : "text-muted";

              return (
                <tr key={row.id} className="border-b border-border/20 hover:bg-card-hover/50 transition-colors">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-semibold border-r border-border whitespace-nowrap">
                    {shortName(row.name)}
                  </td>
                  {owners.map((col) => {
                    if (row.id === col.id) {
                      return (
                        <td
                          key={col.id}
                          className="px-2 py-2 text-center bg-black/40"
                        >
                          <span className="text-[10px] text-muted/40">—</span>
                        </td>
                      );
                    }

                    const rec = h2h.get(row.id)?.get(col.id) ?? { wins: 0, losses: 0 };
                    const color =
                      rec.wins > rec.losses
                        ? "text-accent"
                        : rec.wins < rec.losses
                          ? "text-danger"
                          : "text-muted";

                    return (
                      <td key={col.id} className="px-2 py-2 text-center">
                        <span className={`text-[10px] font-mono ${color}`}>
                          {rec.wins}-{rec.losses}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center border-l border-border">
                    <span className={`text-xs font-mono font-semibold ${totalColor}`}>
                      {total.wins}-{total.losses}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
