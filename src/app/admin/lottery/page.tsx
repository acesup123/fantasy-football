import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Owner } from "@/types/database";
import { validateFinalRankSlots } from "@/lib/draft/lottery-order";
import LotteryClient from "./lottery-client";

interface FinalRankRow {
  owner_id: string;
  final_rank: number;
  seasons: { year: number } | null;
}

function BlockedState({ reason, detail }: { reason: string; detail: string }) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Link href="/admin" className="text-xs text-muted hover:text-accent">
          ← Back to Admin
        </Link>
        <h1 className="text-3xl font-black mt-2">Draft Order Lottery</h1>
      </div>
      <div className="bg-card border border-red-500/30 rounded-xl p-6">
        <h2 className="font-bold text-sm text-red-400">
          Lottery blocked — draft order could not be loaded
        </h2>
        <p className="text-sm text-muted mt-3">{reason}</p>
        <p className="text-xs text-muted/70 mt-3 font-mono break-words">{detail}</p>
        <p className="text-xs text-muted mt-4">
          The lottery will not run on unverified data. Earlier versions of this
          page fell back to a hardcoded order that was seeded from regular-season
          standings rather than final placement — the exact bug this page was
          rewritten to fix — so failing loudly is deliberate.
        </p>
      </div>
    </div>
  );
}

/**
 * Seeds the draft-order lottery from the most recent completed season's
 * post-playoff placement (season_results.final_rank, i.e. ESPN
 * rankCalculatedFinal) — NOT regular-season standings, which differ.
 *
 * Refuses to render the lottery on anything less than a clean, gap-free 1-12.
 * The admin can still override slots 5-12 by hand once it loads.
 */
export default async function LotteryPage() {
  const supabase = await createClient();

  const [{ data: ownerRows, error: ownersError }, { data: rankRows, error: rankError }] =
    await Promise.all([
      supabase.from("owners").select("*").order("name"),
      supabase
        .from("season_results")
        .select("owner_id, final_rank, seasons(year)")
        .not("final_rank", "is", null)
        .order("final_rank"),
    ]);

  if (ownersError || rankError) {
    const err = ownersError ?? rankError;
    const missingColumn = err?.message?.includes("final_rank");
    return (
      <BlockedState
        reason={
          missingColumn
            ? "The final_rank column does not exist yet — migration 002_final_rank_and_standings.sql has not been applied to this database."
            : "The database query for the draft order failed."
        }
        detail={err?.message ?? "Unknown error"}
      />
    );
  }

  const owners = (ownerRows ?? []) as Owner[];
  const ranked = (rankRows ?? []) as unknown as FinalRankRow[];

  // Use the most recent season that has final placement recorded
  const latestYear = ranked.reduce<number | null>((max, r) => {
    const y = r.seasons?.year;
    return typeof y === "number" && (max === null || y > max) ? y : max;
  }, null);

  // Note: the owners table holds more than 12 rows — departed owners are kept
  // for history — so validation is on the slots, not the roster size.
  const slots = validateFinalRankSlots(
    ranked
      .filter((r) => r.seasons?.year === latestYear)
      .map((r) => ({ ownerId: r.owner_id, finish: r.final_rank })),
    new Set(owners.map((o) => o.id))
  );

  if (!slots) {
    return (
      <BlockedState
        reason={
          latestYear
            ? `Final placement for ${latestYear} is incomplete. The lottery needs a gap-free 1-12 with 12 distinct owners; run the ESPN sync for that season and try again.`
            : "No season has final placement recorded yet. Run the ESPN sync for the most recent completed season."
        }
        detail={`Found ${ranked.filter((r) => r.seasons?.year === latestYear).length} of 12 usable slots${
          latestYear ? ` for ${latestYear}` : ""
        }.`}
      />
    );
  }

  return (
    <LotteryClient
      owners={owners}
      defaultOrder={slots}
      seasonYear={latestYear!}
      orderSource={`${latestYear} final placement, after playoffs`}
    />
  );
}
