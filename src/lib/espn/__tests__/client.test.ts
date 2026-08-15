import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStandings,
  compareStandings,
  getDivisionNames,
  getCurrentNFLSeason,
  getOwnerName,
  isSeasonComplete,
  rankOrNull,
} from "../client";

const completeStatus = { finalScoringPeriod: 17, latestScoringPeriod: 19 };

describe("getOwnerName", () => {
  it("resolves both sides of every franchise handoff", () => {
    expect(getOwnerName(4, 2020)).toBe("Bill Kling");
    expect(getOwnerName(4, 2021)).toBe("Ryan Parrilla");
    expect(getOwnerName(10, 2015)).toBe("Aaron Schwartz");
    expect(getOwnerName(10, 2016)).toBe("Marcus Moore");
    expect(getOwnerName(12, 2017)).toBe("Matt B");
    expect(getOwnerName(12, 2018)).toBe("Lance Michihira");
  });

  it("returns null for an unknown team or an out-of-range year", () => {
    expect(getOwnerName(13, 2025)).toBeNull();
    expect(getOwnerName(1, 2009)).toBeNull();
  });

  it("maps all 12 teams to 12 distinct owners for every season 2010-2026", () => {
    // The invariant that matters: any gap in the TEAM_OWNERS year ranges makes
    // the sync write fewer than 12 rows, which makes the lottery page refuse to
    // load. One property test catches every future range typo.
    for (let year = 2010; year <= 2026; year++) {
      const names = Array.from({ length: 12 }, (_, i) => getOwnerName(i + 1, year));
      expect(names.filter(Boolean), `year ${year}`).toHaveLength(12);
      expect(new Set(names).size, `year ${year} distinct`).toBe(12);
    }
  });
});

describe("rankOrNull", () => {
  it("treats ESPN's preseason 0 as no rank", () => {
    expect(rankOrNull(0)).toBeNull();
  });

  it("rejects negatives, non-numbers and missing values", () => {
    expect(rankOrNull(-1)).toBeNull();
    expect(rankOrNull(undefined)).toBeNull();
    expect(rankOrNull(null)).toBeNull();
    expect(rankOrNull(NaN)).toBeNull();
    expect(rankOrNull("3")).toBeNull();
  });

  it("passes real ranks through", () => {
    expect(rankOrNull(1)).toBe(1);
    expect(rankOrNull(12)).toBe(12);
  });
});

describe("isSeasonComplete", () => {
  it("is true once the latest scoring period reaches the final one", () => {
    expect(isSeasonComplete({ status: completeStatus })).toBe(true);
    expect(
      isSeasonComplete({ status: { finalScoringPeriod: 17, latestScoringPeriod: 17 } })
    ).toBe(true);
  });

  it("is false mid-season", () => {
    expect(
      isSeasonComplete({ status: { finalScoringPeriod: 17, latestScoringPeriod: 9 } })
    ).toBe(false);
  });

  it("is false for an unset season reporting 0/0", () => {
    // 0 >= 0 would otherwise call an unplayed season complete, letting a
    // projected rankCalculatedFinal be recorded as a real result.
    expect(
      isSeasonComplete({ status: { finalScoringPeriod: 0, latestScoringPeriod: 0 } })
    ).toBe(false);
  });

  it("ignores status.isActive, which stays true on a finished season", () => {
    expect(isSeasonComplete({ status: { ...completeStatus, isActive: true } })).toBe(true);
    expect(
      isSeasonComplete({
        status: { finalScoringPeriod: 17, latestScoringPeriod: 3, isActive: true },
      })
    ).toBe(false);
  });

  it("fails safe on missing data", () => {
    expect(isSeasonComplete({})).toBe(false);
    expect(isSeasonComplete({ status: {} })).toBe(false);
  });
});

describe("buildStandings", () => {
  const team = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    playoffSeed: 0,
    rankCalculatedFinal: 0,
    record: { overall: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 } },
    ...over,
  });

  it("maps ESPN's preseason 0 ranks to null rather than 0", () => {
    const rows = buildStandings(
      { status: { finalScoringPeriod: 17, latestScoringPeriod: 0 }, teams: [team(1)] },
      2026
    );
    expect(rows[0].playoffSeed).toBeNull();
    expect(rows[0].finalRank).toBeNull();
  });

  it("withholds finalRank until the season is complete", () => {
    const league = {
      status: { finalScoringPeriod: 17, latestScoringPeriod: 9 },
      teams: [team(1, { rankCalculatedFinal: 3, playoffSeed: 3 })],
    };
    // mid-season rankCalculatedFinal is a projection, not a result
    expect(buildStandings(league, 2026)[0].finalRank).toBeNull();
    expect(buildStandings(league, 2026)[0].playoffSeed).toBe(3);

    const done = { ...league, status: completeStatus };
    expect(buildStandings(done, 2026)[0].finalRank).toBe(3);
  });

  it("handles a missing teams array and a team with no record", () => {
    expect(buildStandings({ status: completeStatus }, 2025)).toEqual([]);
    const rows = buildStandings({ status: completeStatus, teams: [{ id: 1 }] }, 2025);
    expect(rows[0].wins).toBe(0);
    expect(rows[0].pointsFor).toBe(0);
  });
});

describe("getDivisionNames", () => {
  it("maps division ids to names from scheduleSettings", () => {
    const map = getDivisionNames({
      settings: {
        scheduleSettings: {
          divisions: [
            { id: 1, name: "Division 1", size: 6 },
            { id: 2, name: "Division 2", size: 6 },
          ],
        },
      },
    });
    expect(map.get(1)).toBe("Division 1");
    expect(map.get(2)).toBe("Division 2");
  });

  it("returns an empty map without the mSettings view", () => {
    // The sync must request mSettings; without it divisions are simply absent
    // rather than throwing.
    expect(getDivisionNames({ teams: [] }).size).toBe(0);
    expect(getDivisionNames(null).size).toBe(0);
  });

  it("skips malformed division entries", () => {
    const map = getDivisionNames({
      settings: { scheduleSettings: { divisions: [{ id: "x", name: 1 }, { id: 3 }] } },
    });
    expect(map.size).toBe(0);
  });
});

describe("buildStandings divisions", () => {
  const league = {
    status: completeStatus,
    settings: {
      scheduleSettings: {
        divisions: [
          { id: 1, name: "Division 1", size: 6 },
          { id: 2, name: "Division 2", size: 6 },
        ],
      },
    },
    teams: [
      {
        id: 8,
        divisionId: 1,
        playoffSeed: 1,
        rankCalculatedFinal: 1,
        record: {
          overall: { wins: 11, losses: 3, ties: 0, pointsFor: 1873, pointsAgainst: 1615 },
          division: { wins: 8, losses: 2, ties: 0 },
        },
      },
      { id: 2, playoffSeed: 12, record: { overall: { wins: 4, losses: 10, ties: 0 } } },
    ],
  };

  it("attaches division id, name and in-division record", () => {
    const sal = buildStandings(league, 2025).find((r) => r.espnTeamId === 8)!;
    expect(sal.divisionId).toBe(1);
    expect(sal.divisionName).toBe("Division 1");
    expect(sal.divisionWins).toBe(8);
    expect(sal.divisionLosses).toBe(2);
  });

  it("nulls division fields for a team with no divisionId or division record", () => {
    const joel = buildStandings(league, 2025).find((r) => r.espnTeamId === 2)!;
    expect(joel.divisionId).toBeNull();
    expect(joel.divisionName).toBeNull();
    expect(joel.divisionWins).toBeNull();
  });
});

describe("compareStandings", () => {
  const row = (over: Partial<Parameters<typeof compareStandings>[0]>) => ({
    playoffSeed: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    ...over,
  });

  it("orders by seed when both rows have one", () => {
    expect(compareStandings(row({ playoffSeed: 2 }), row({ playoffSeed: 5 }))).toBeLessThan(0);
  });

  it("sorts seeded rows ahead of unseeded ones, keeping the comparator transitive", () => {
    const seeded = row({ playoffSeed: 9, wins: 0 });
    const unseeded = row({ wins: 14 });
    expect(compareStandings(seeded, unseeded)).toBeLessThan(0);
    expect(compareStandings(unseeded, seeded)).toBeGreaterThan(0);
  });

  it("counts a tie as half a win when falling back", () => {
    // 6-5-1 (.542) must beat 6-6-0 (.500) — raw wins alone would call them equal
    const tied = row({ wins: 6, losses: 5, ties: 1 });
    const straight = row({ wins: 6, losses: 6, ties: 0 });
    expect(compareStandings(tied, straight)).toBeLessThan(0);
  });

  it("breaks a win-pct tie on points for", () => {
    const high = row({ wins: 6, losses: 6, pointsFor: 1800 });
    const low = row({ wins: 6, losses: 6, pointsFor: 1500 });
    expect(compareStandings(high, low)).toBeLessThan(0);
  });

  it("produces a stable total order over a mixed seeded/unseeded set", () => {
    const rows = [
      row({ wins: 3, pointsFor: 100 }),
      row({ playoffSeed: 4 }),
      row({ wins: 9, pointsFor: 200 }),
      row({ playoffSeed: 1 }),
    ];
    const sorted = [...rows].sort(compareStandings);
    expect(sorted.map((r) => r.playoffSeed)).toEqual([1, 4, null, null]);
    // and re-sorting an already sorted list is a fixed point
    expect([...sorted].sort(compareStandings)).toEqual(sorted);
  });
});

describe("getCurrentNFLSeason", () => {
  afterEach(() => vi.useRealTimers());

  it("treats Jan/Feb as the previous season and Mar onward as the current one", () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date(2026, 1, 28)); // Feb 2026
    expect(getCurrentNFLSeason()).toBe(2025);

    vi.setSystemTime(new Date(2026, 2, 1)); // Mar 2026
    expect(getCurrentNFLSeason()).toBe(2026);

    vi.setSystemTime(new Date(2026, 11, 31)); // Dec 2026
    expect(getCurrentNFLSeason()).toBe(2026);
  });
});
