export default function TradesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Trade Center</h1>
          <p className="text-muted text-sm">
            Propose trades, view history, and manage draft picks year-round
          </p>
        </div>
        <button className="px-4 py-2 bg-accent text-background rounded-md text-sm font-medium hover:bg-accent-hover transition-colors">
          New Trade
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["All", "Pending", "Accepted", "Declined"].map((filter) => (
          <button
            key={filter}
            className="px-3 py-1.5 bg-card border border-border rounded-md text-sm hover:bg-card-hover transition-colors"
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Trade list placeholder */}
      <div className="space-y-3">
        <TradeCard
          date="Mar 15, 2026"
          context="offseason"
          status="accepted"
          team1="Team 1"
          team1Gives="2026 Round 3 Pick"
          team2="Team 5"
          team2Gives="2026 Round 6 Pick + 2027 Round 2 Pick"
        />
        <TradeCard
          date="Jan 8, 2026"
          context="in_season"
          status="accepted"
          team1="Team 3"
          team1Gives="Patrick Mahomes (QB, KC)"
          team2="Team 7"
          team2Gives="Josh Allen (QB, BUF) + 2026 Round 4 Pick"
        />
        <TradeCard
          date="Sep 22, 2025"
          context="in_season"
          status="declined"
          team1="Team 8"
          team1Gives="2026 Round 1 Pick"
          team2="Team 2"
          team2Gives="2026 Round 2 Pick + 2026 Round 5 Pick"
        />
      </div>

      {/* Pick ownership tracker */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Draft Pick Ownership</h2>
        <p className="text-muted text-sm mb-3">
          See who owns each draft pick for upcoming seasons
        </p>
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted">
          Connect to Supabase to see pick ownership
        </div>
      </section>
    </div>
  );
}

function TradeCard({
  date,
  context,
  status,
  team1,
  team1Gives,
  team2,
  team2Gives,
}: {
  date: string;
  context: string;
  status: string;
  team1: string;
  team1Gives: string;
  team2: string;
  team2Gives: string;
}) {
  const statusColors: Record<string, string> = {
    pending: "text-warning bg-warning/10",
    accepted: "text-accent bg-accent/10",
    declined: "text-danger bg-danger/10",
  };

  const contextLabels: Record<string, string> = {
    draft: "Draft Day",
    in_season: "In-Season",
    offseason: "Offseason",
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{date}</span>
          <span className="text-xs text-muted bg-background px-2 py-0.5 rounded">
            {contextLabels[context] ?? context}
          </span>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            statusColors[status] ?? "text-muted bg-background"
          }`}
        >
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
        <div>
          <div className="text-sm font-semibold mb-1">{team1}</div>
          <div className="text-xs text-danger">Sends: {team1Gives}</div>
        </div>
        <div className="text-muted text-lg">⇄</div>
        <div className="text-right">
          <div className="text-sm font-semibold mb-1">{team2}</div>
          <div className="text-xs text-accent">Sends: {team2Gives}</div>
        </div>
      </div>
    </div>
  );
}
