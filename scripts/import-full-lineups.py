"""
Import full per-week lineups from ESPN.

This makes per-scoring-period API calls to get every player's score
for every week of every season. ~250 calls per season, 16 seasons.
"""

import json
import urllib.request
import time
from supabase import create_client

SUPABASE_URL = "https://untdbanhuzzibjelwpxp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudGRiYW5odXp6aWJqZWx3cHhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0ODc2OSwiZXhwIjoyMDg5NDI0NzY5fQ.X5szKSmzmWvTKEXsBHlwNrOGh7PgMCAistQIzWGJ4Zk"
ESPN_SWID = "{E66646D5-DB34-4E80-9E1C-501BFDF177FF}"
ESPN_S2 = "AEAy381uA8k5v95VBQ780W%2BGPsfWMzZ5ktlaE3SU6ezH9NnsNMf%2Bfz1LVzJqtbdVHW%2FZlkN14MlgiZlYPItbPNG2oT5cbzo4487vn18L02BLftYswBSlLj6SUwlMMkLRxEXkw5S4cuTl6PFtvb1aEUBnxW24JeS53LdceSrMtzICACVGVoS%2BdCDWBVBZjr8b0gr%2BCtd6vOnYJ0lNp9G0uyBA767JUMb6dJP5OfJphWzQkx8OuQ%2F6uDIH8j2A3Y7g4G6cDWBpcFFXLRdd0fh%2Fn4qBUa9HXeYaa1X8PAzLfzBK8g%3D%3D"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

TEAM_OWNERS = {
    1:  [("Alex Altman", 2010, 9999)],
    2:  [("Joel Oubre", 2010, 9999)],
    3:  [("Kevin Whitlock", 2010, 9999)],
    4:  [("Bill Kling", 2010, 2020), ("Ryan Parrilla", 2021, 9999)],
    5:  [("Kelly Mann", 2010, 9999)],
    6:  [("Justin Choy", 2010, 9999)],
    7:  [("Ed Lang", 2010, 9999)],
    8:  [("Sal Singh", 2010, 9999)],
    9:  [("Navi Singh", 2010, 9999)],
    10: [("Aaron Schwartz", 2010, 2015), ("Marcus Moore", 2016, 9999)],
    11: [("Jason McCartney", 2010, 9999)],
    12: [("Matt B", 2010, 2017), ("Lance Michihira", 2018, 9999)],
}

ESPN_SLOT_MAP = {0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "DEF", 17: "K", 20: "BN", 21: "IR", 23: "FLEX"}
ESPN_POS_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

def get_owner_name(team_id, year):
    for name, frm, to in TEAM_OWNERS.get(team_id, []):
        if frm <= year <= to:
            return name
    return None

# Caches
owner_id_cache = {o["name"]: o["id"] for o in sb.table("owners").select("id, name").execute().data}
season_id_cache = {s["year"]: s["id"] for s in sb.table("seasons").select("id, year").execute().data}
player_cache = {p["name"].lower(): p["id"] for p in sb.table("players").select("id, name").execute().data}

# Load existing matchup IDs by (season_id, week, home_owner_id)
print("Loading existing matchups...")
matchup_cache = {}
offset = 0
while True:
    batch = sb.table("matchups").select("id, season_id, week, home_owner_id, away_owner_id").range(offset, offset + 999).execute()
    if not batch.data:
        break
    for m in batch.data:
        matchup_cache[(m["season_id"], m["week"], m["home_owner_id"])] = m["id"]
        matchup_cache[(m["season_id"], m["week"], m["away_owner_id"])] = m["id"]
    offset += 1000
print(f"Loaded {len(matchup_cache)} matchup index entries")


def get_or_create_player(name, position):
    key = name.lower()
    if key in player_cache:
        return player_cache[key]
    existing = sb.table("players").select("id").ilike("name", name).execute()
    if existing.data:
        player_cache[key] = existing.data[0]["id"]
        return player_cache[key]
    pos = position or "RB"
    resp = sb.table("players").insert({"name": name, "position": pos, "is_active": False}).execute()
    if resp.data:
        player_cache[key] = resp.data[0]["id"]
        return player_cache[key]
    return None


def espn_fetch(year, scoring_period):
    """Fetch matchup data with rosters for a specific scoring period."""
    if year <= 2017:
        url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/130046?seasonId={year}&view=mMatchup&view=mMatchupScore&view=mRoster&view=mTeam&scoringPeriodId={scoring_period}"
    else:
        url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/130046?view=mMatchup&view=mMatchupScore&view=mRoster&view=mTeam&scoringPeriodId={scoring_period}"

    req = urllib.request.Request(url)
    req.add_header("Cookie", f"SWID={ESPN_SWID}; espn_s2={ESPN_S2}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        if isinstance(data, list) and data:
            return data[0]
        return data
    except Exception as e:
        print(f"    API error: {e}")
        return None


def process_week(year, week, league_data):
    """Extract and insert lineup data for a specific week."""
    season_id = season_id_cache.get(year)
    if not season_id:
        return 0

    schedule = league_data.get("schedule", [])
    week_matchups = [m for m in schedule if m.get("matchupPeriodId") == week]

    lineup_count = 0

    for m in week_matchups:
        home = m.get("home", {})
        away = m.get("away", {})

        for side in [home, away]:
            team_id = side.get("teamId")
            if not team_id:
                continue

            owner_name = get_owner_name(team_id, year)
            owner_id = owner_id_cache.get(owner_name) if owner_name else None
            if not owner_id:
                continue

            # Find the matchup ID
            matchup_id = matchup_cache.get((season_id, week, owner_id))
            if not matchup_id:
                continue

            # Get roster — try matchup period first, then current
            roster = side.get("rosterForMatchupPeriod", {}).get("entries", [])
            if not roster:
                roster = side.get("rosterForCurrentScoringPeriod", {}).get("entries", [])
            if not roster:
                continue

            rows = []
            for entry in roster:
                player_info = entry.get("playerPoolEntry", {}).get("player", {})
                player_name = player_info.get("fullName", "")
                if not player_name:
                    continue

                espn_pos_id = player_info.get("defaultPositionId")
                position = ESPN_POS_MAP.get(espn_pos_id, "RB")
                slot_id = entry.get("lineupSlotId", 20)
                slot_name = ESPN_SLOT_MAP.get(slot_id, "BN")
                is_starter = slot_id not in (20, 21)

                # Find points for this specific scoring period
                pts = 0
                for stat in player_info.get("stats", []):
                    if stat.get("scoringPeriodId") == week and stat.get("statSourceId", 0) == 0:
                        pts = stat.get("appliedTotal", 0)
                        break

                player_id = get_or_create_player(player_name, position)
                if not player_id:
                    continue

                rows.append({
                    "matchup_id": matchup_id,
                    "owner_id": owner_id,
                    "player_id": player_id,
                    "lineup_slot": slot_name,
                    "points": round(pts, 2),
                    "is_starter": is_starter,
                })

            if rows:
                try:
                    sb.table("matchup_lineups").insert(rows).execute()
                    lineup_count += len(rows)
                except Exception as e:
                    # May get duplicates if partial data existed
                    pass

    return lineup_count


def main():
    print("🏈 Full Per-Week Lineup Importer")
    print("=" * 50)

    # First, clear existing partial lineup data so we don't get duplicates
    print("Clearing existing partial lineup data...")
    # Delete in batches
    while True:
        batch = sb.table("matchup_lineups").select("id").limit(1000).execute()
        if not batch.data:
            break
        ids = [r["id"] for r in batch.data]
        sb.table("matchup_lineups").delete().in_("id", ids).execute()
        print(f"  Deleted {len(ids)} rows...")
    print("  Cleared!")

    total_lineups = 0

    for year in range(2010, 2026):
        print(f"\n=== {year} ===")

        # Determine number of weeks (regular season typically 13-14, + playoffs)
        max_week = 16 if year <= 2020 else 17
        year_lineups = 0

        for week in range(1, max_week + 1):
            league_data = espn_fetch(year, week)
            if not league_data:
                print(f"  Wk{week}: no data")
                continue

            count = process_week(year, week, league_data)
            year_lineups += count

            if week % 4 == 0:
                print(f"  Wk{week}: {year_lineups} lineups so far")

            # Brief pause to avoid rate limiting
            time.sleep(0.3)

        total_lineups += year_lineups
        print(f"  ✅ {year}: {year_lineups} lineup entries")

    print(f"\n✅ Done! {total_lineups} total lineup entries across all seasons")


if __name__ == "__main__":
    main()
