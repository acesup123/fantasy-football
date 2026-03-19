"""
Import all matchups and lineups from ESPN into Supabase.

16 seasons (2010-2025), ~100 matchups per season, ~10-16 players per lineup.
"""

import json
import urllib.request
import time
from supabase import create_client

# ============================================================
# CONFIG
# ============================================================

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

# ESPN lineup slot IDs → readable names
# 0=QB, 2=RB, 4=WR, 6=TE, 16=D/ST, 17=K, 20=Bench, 21=IR, 23=FLEX
ESPN_SLOT_MAP = {
    0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "DEF", 17: "K",
    20: "BN", 21: "IR", 23: "FLEX",
}

# ESPN position IDs
ESPN_POS_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

def get_owner_name(team_id, year):
    for name, frm, to in TEAM_OWNERS.get(team_id, []):
        if frm <= year <= to:
            return name
    return None

# ============================================================
# CACHES
# ============================================================

owner_id_cache = {}
for o in sb.table("owners").select("id, name").execute().data:
    owner_id_cache[o["name"]] = o["id"]

season_id_cache = {}
for s in sb.table("seasons").select("id, year").execute().data:
    season_id_cache[s["year"]] = s["id"]

player_cache = {}
for p in sb.table("players").select("id, name").execute().data:
    player_cache[p["name"].lower()] = p["id"]


def get_or_create_player(name, position):
    key = name.lower()
    if key in player_cache:
        return player_cache[key]

    existing = sb.table("players").select("id").ilike("name", name).execute()
    if existing.data:
        player_cache[key] = existing.data[0]["id"]
        return player_cache[key]

    pos = position or "RB"
    resp = sb.table("players").insert({
        "name": name, "position": pos, "is_active": False,
    }).execute()
    if resp.data:
        player_cache[key] = resp.data[0]["id"]
        return player_cache[key]
    return None


def get_owner_id(name):
    return owner_id_cache.get(name)


# ============================================================
# ESPN FETCH
# ============================================================

def espn_fetch_modern(year, views, scoring_period=None):
    view_params = "&".join(f"view={v}" for v in views)
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/130046?{view_params}"
    if scoring_period:
        url += f"&scoringPeriodId={scoring_period}"
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"SWID={ESPN_SWID}; espn_s2={ESPN_S2}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def espn_fetch_legacy(year, views):
    view_params = "&".join(f"view={v}" for v in views)
    url = f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/130046?seasonId={year}&{view_params}"
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"SWID={ESPN_SWID}; espn_s2={ESPN_S2}")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    if isinstance(data, list) and data:
        return data[0]
    return None


# ============================================================
# IMPORT LOGIC
# ============================================================

def import_year(year):
    season_id = season_id_cache.get(year)
    if not season_id:
        print(f"  !! No season for {year}")
        return

    # Check if already imported
    existing = sb.table("matchups").select("id", count="exact", head=True).eq("season_id", season_id).execute()
    if existing.count > 0:
        print(f"  Already has {existing.count} matchups — skipping")
        return

    # Fetch matchup data
    if year <= 2017:
        league = espn_fetch_legacy(year, ["mTeam", "mMatchup", "mMatchupScore"])
    else:
        league = espn_fetch_modern(year, ["mTeam", "mMatchup", "mMatchupScore"])

    if not league:
        print(f"  No data")
        return

    schedule = league.get("schedule", [])
    print(f"  {len(schedule)} matchups found")

    matchup_count = 0
    lineup_count = 0

    for m in schedule:
        week = m.get("matchupPeriodId")
        if not week:
            continue

        home = m.get("home", {})
        away = m.get("away", {})
        h_team_id = home.get("teamId")
        a_team_id = away.get("teamId")

        if not h_team_id or not a_team_id:
            continue

        h_owner_name = get_owner_name(h_team_id, year)
        a_owner_name = get_owner_name(a_team_id, year)
        h_owner_id = get_owner_id(h_owner_name) if h_owner_name else None
        a_owner_id = get_owner_id(a_owner_name) if a_owner_name else None

        if not h_owner_id or not a_owner_id:
            continue

        h_pts = home.get("totalPoints", 0)
        a_pts = away.get("totalPoints", 0)

        winner_str = m.get("winner")
        if winner_str == "HOME":
            winner_id = h_owner_id
        elif winner_str == "AWAY":
            winner_id = a_owner_id
        else:
            winner_id = None

        playoff_tier = m.get("playoffTierType")
        is_playoff = playoff_tier is not None and playoff_tier != "NONE"

        # Insert matchup
        resp = sb.table("matchups").insert({
            "season_id": season_id,
            "week": week,
            "home_owner_id": h_owner_id,
            "away_owner_id": a_owner_id,
            "home_points": h_pts,
            "away_points": a_pts,
            "winner_owner_id": winner_id,
            "is_playoff": is_playoff,
            "playoff_tier": playoff_tier if is_playoff else None,
        }).execute()

        if not resp.data:
            continue

        matchup_id = resp.data[0]["id"]
        matchup_count += 1

        # Import lineups from matchup
        for side, side_owner_id in [(home, h_owner_id), (away, a_owner_id)]:
            roster = side.get("rosterForMatchupPeriod", {}).get("entries", [])
            if not roster:
                roster = side.get("rosterForCurrentScoringPeriod", {}).get("entries", [])

            lineup_rows = []
            for entry in roster:
                player_info = entry.get("playerPoolEntry", {}).get("player", {})
                player_name = player_info.get("fullName", "")
                if not player_name:
                    continue

                espn_pos_id = player_info.get("defaultPositionId")
                position = ESPN_POS_MAP.get(espn_pos_id, "RB")
                slot_id = entry.get("lineupSlotId", 20)
                slot_name = ESPN_SLOT_MAP.get(slot_id, "BN")
                is_starter = slot_id not in (20, 21)  # Not bench or IR

                # Get player points for this week
                pts = 0
                for stat in player_info.get("stats", []):
                    sp = stat.get("scoringPeriodId")
                    src = stat.get("statSourceId", 0)
                    # Match the scoring period to the matchup week
                    # For multi-week matchups, appliedTotal covers all
                    if src == 0:  # Actual stats (not projected)
                        pts = stat.get("appliedTotal", 0)
                        break

                player_id = get_or_create_player(player_name, position)
                if not player_id:
                    continue

                lineup_rows.append({
                    "matchup_id": matchup_id,
                    "owner_id": side_owner_id,
                    "player_id": player_id,
                    "lineup_slot": slot_name,
                    "points": round(pts, 2),
                    "is_starter": is_starter,
                })

            if lineup_rows:
                sb.table("matchup_lineups").insert(lineup_rows).execute()
                lineup_count += len(lineup_rows)

    print(f"  ✅ {matchup_count} matchups, {lineup_count} lineup entries")


# ============================================================
# MAIN
# ============================================================

def main():
    print("🏈 Matchup & Lineup Importer")
    print("=" * 50)

    for year in range(2010, 2026):
        print(f"\n=== {year} ===")
        try:
            import_year(year)
        except Exception as e:
            print(f"  ❌ Error: {e}")
        # Brief pause to avoid rate limiting
        time.sleep(0.5)

    print("\n✅ All done!")


if __name__ == "__main__":
    main()
