# Fantasy Football League Manager

## Overview
12-team superflex keeper league management app. Handles offseason management, live drafts, trade tracking, and historical records. In-season play happens on ESPN.

## Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend**: Supabase (Postgres + Realtime + Auth)
- **No component libraries** — custom UI with Tailwind

## Key Commands
```bash
cd /Users/alexaltman/fantasy-football
npm run dev              # Start dev server
npm run build            # Production build
```

## League Rules
- 12 teams, 15-round snake draft
- Superflex: QB + SF (any offensive player)
- Roster: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (RB/WR/TE), 1 SF (QB/RB/WR/TE), 1 DEF, 6 BN, 2 IR
- Must draft every position — can't skip DEF or TE
- Keeper league: max 5 keepers, up to 5 years from draft
  - Year 1 = drafted, K1 = first keep, K2, K3, K4 = final eligible year
  - Cost escalates: round goes up by 1 each year kept
  - Round 1 keepers always cost round 1
  - Free agent pickups start as round 10 keepers
- Trades: year-round, picks + players, current + future years, conditional trades supported
- Draft pick trades execute immediately (no admin approval)

## Architecture
- Supabase Realtime for live draft board + trade notifications
- Auth via Supabase magic links
- RLS: all authenticated users can read; owners write only their own data
- API routes validate picks, trades server-side

## Database
Schema in `supabase/migrations/001_schema.sql`. Key tables:
- `owners`, `seasons`, `season_results`
- `players`, `draft_picks`, `keepers`
- `trades`, `trade_assets`, `trade_conditions`
- `rosters`, `league_settings`
- `auto_draft_settings`, `auto_draft_rankings`
