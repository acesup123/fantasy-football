import type { Player, AutoDraftSettings, PositionRule } from '@/types/database';

interface AutoPickContext {
  availablePlayers: Player[];
  customRankings: { player_id: number; rank: number }[] | null;
  settings: AutoDraftSettings | null;
  currentRoster: { position: string; count: number }[];
  currentRound: number;
  totalRounds: number;
}

/**
 * Determine the best auto-pick based on owner's custom rankings and position rules.
 *
 * Priority:
 * 1. Check position rules for mandatory picks (e.g., "must have 2 RBs by round 4")
 * 2. Check position rules for restrictions (e.g., "no DEF before round 12")
 * 3. Pick highest-ranked available player from custom rankings (or default ADP)
 * 4. Respect position maximums
 * 5. Ensure all required positions are filled by end of draft
 */
export function getAutoPick(context: AutoPickContext): Player | null {
  const {
    availablePlayers,
    customRankings,
    settings,
    currentRoster,
    currentRound,
    totalRounds,
  } = context;

  if (availablePlayers.length === 0) return null;

  const rules = settings?.position_rules ?? [];
  const rosterCounts = new Map(
    currentRoster.map((r) => [r.position, r.count])
  );

  // Get count of a position on current roster
  const posCount = (pos: string) => rosterCounts.get(pos) ?? 0;

  // Check which positions MUST be drafted now based on rules
  const urgentPositions = getUrgentPositions(rules, rosterCounts, currentRound);

  // Check which positions are restricted this round
  const restrictedPositions = getRestrictedPositions(rules, rosterCounts, currentRound);

  // Check if we need to fill required positions before draft ends
  const roundsLeft = totalRounds - currentRound;
  const mustFill = getMustFillPositions(rosterCounts, roundsLeft);

  // Build candidate list: filter available players
  let candidates = availablePlayers.filter((p) => {
    // Respect position maximums from rules
    const maxRule = rules.find((r) => r.position === p.position && r.max !== undefined);
    if (maxRule && posCount(p.position) >= maxRule.max!) return false;

    // Respect "not before round" restrictions
    if (restrictedPositions.includes(p.position)) return false;

    return true;
  });

  // If there are urgent needs, prioritize those positions
  if (urgentPositions.length > 0) {
    const urgentCandidates = candidates.filter((p) =>
      urgentPositions.includes(p.position)
    );
    if (urgentCandidates.length > 0) {
      candidates = urgentCandidates;
    }
  }

  // If we must fill required positions soon, prioritize those
  if (mustFill.length > 0 && roundsLeft <= mustFill.length + 1) {
    const mustFillCandidates = candidates.filter((p) =>
      mustFill.includes(p.position)
    );
    if (mustFillCandidates.length > 0) {
      candidates = mustFillCandidates;
    }
  }

  // Sort by custom rankings if available, otherwise by player ID (proxy for ADP)
  if (customRankings && customRankings.length > 0) {
    const rankMap = new Map(customRankings.map((r) => [r.player_id, r.rank]));
    candidates.sort((a, b) => {
      const rankA = rankMap.get(a.id) ?? Infinity;
      const rankB = rankMap.get(b.id) ?? Infinity;
      return rankA - rankB;
    });
  }

  return candidates[0] ?? null;
}

/**
 * Positions that must be drafted NOW based on "min X by round Y" rules.
 */
function getUrgentPositions(
  rules: PositionRule[],
  rosterCounts: Map<string, number>,
  currentRound: number
): string[] {
  const urgent: string[] = [];

  for (const rule of rules) {
    if (rule.min && rule.by_round && currentRound >= rule.by_round) {
      const current = rosterCounts.get(rule.position) ?? 0;
      if (current < rule.min) {
        urgent.push(rule.position);
      }
    }
  }

  return urgent;
}

/**
 * Positions that should NOT be drafted this round based on "not before round X" rules.
 */
function getRestrictedPositions(
  rules: PositionRule[],
  _rosterCounts: Map<string, number>,
  currentRound: number
): string[] {
  const restricted: string[] = [];

  for (const rule of rules) {
    if (rule.not_before_round && currentRound < rule.not_before_round) {
      restricted.push(rule.position);
    }
  }

  return restricted;
}

/**
 * Required positions not yet on the roster.
 * Every team MUST have: 1 QB, 1 TE, 1 DEF (plus RB/WR filled naturally).
 */
function getMustFillPositions(
  rosterCounts: Map<string, number>,
  _roundsLeft: number
): string[] {
  const mustFill: string[] = [];

  // Minimum required: 1 QB, 2 RB, 2 WR, 1 TE, 1 DEF
  const minimums: Record<string, number> = {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    DEF: 1,
  };

  for (const [pos, min] of Object.entries(minimums)) {
    if ((rosterCounts.get(pos) ?? 0) < min) {
      mustFill.push(pos);
    }
  }

  return mustFill;
}

/**
 * Validate that a roster meets minimum position requirements.
 * Used to check if a draft is valid at completion.
 */
export function validateRoster(
  roster: { position: string }[]
): { valid: boolean; missing: string[] } {
  const counts = new Map<string, number>();
  roster.forEach((p) => {
    counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  });

  const missing: string[] = [];
  const minimums: Record<string, number> = {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    DEF: 1,
  };

  for (const [pos, min] of Object.entries(minimums)) {
    if ((counts.get(pos) ?? 0) < min) {
      missing.push(pos);
    }
  }

  return { valid: missing.length === 0, missing };
}
