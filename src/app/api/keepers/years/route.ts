import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/keepers/years
 * Returns all years that have keeper data (from draft_picks where is_keeper = true).
 */
export async function GET() {
  const { data } = await supabase
    .from('draft_picks')
    .select('seasons(year)')
    .eq('is_keeper', true);

  const years = new Set<number>();
  for (const d of data ?? []) {
    const year = (d.seasons as any)?.year;
    if (year) years.add(year);
  }

  const sorted = Array.from(years).sort((a, b) => b - a);
  return NextResponse.json(sorted);
}
