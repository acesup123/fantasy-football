import { NextResponse } from 'next/server';

/**
 * GET /api/players/espn/[espnId]
 * Proxies ESPN's public athlete bio API into a trimmed payload for the
 * profile modal. Proxying (rather than calling ESPN from the browser)
 * keeps us immune to their CORS policy and lets us cache server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ espnId: string }> }
) {
  const { espnId } = await params;
  if (!/^\d+$/.test(espnId)) {
    return NextResponse.json({ error: 'Invalid ESPN ID' }, { status: 400 });
  }

  const resp = await fetch(
    `https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`,
    { next: { revalidate: 300 } }
  );
  if (!resp.ok) {
    return NextResponse.json({ error: 'ESPN profile unavailable' }, { status: 502 });
  }

  const json = await resp.json();
  const a = json.athlete ?? json;

  interface EspnStat {
    abbreviation?: string;
    displayName?: string;
    displayValue?: string;
    rankDisplayValue?: string;
  }

  return NextResponse.json(
    {
      name: a.displayName ?? null,
      headshot: a.headshot?.href ?? null,
      jersey: a.displayJersey ?? (a.jersey ? `#${a.jersey}` : null),
      position: a.position?.abbreviation ?? null,
      team: a.team?.displayName ?? null,
      age: a.age ?? null,
      height: a.displayHeight ?? null,
      weight: a.displayWeight ?? null,
      college: a.college?.name ?? null,
      experience: a.displayExperience ?? null,
      draft: a.displayDraft ?? null,
      birthPlace: a.displayBirthPlace ?? null,
      status: a.status?.name ?? null,
      statsLabel: a.statsSummary?.displayName ?? null,
      stats: (a.statsSummary?.statistics ?? []).map((s: EspnStat) => ({
        abbreviation: s.abbreviation ?? null,
        displayName: s.displayName ?? null,
        displayValue: s.displayValue ?? null,
        rank: s.rankDisplayValue ?? null,
      })),
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
  );
}
