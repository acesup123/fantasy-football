import type { Player } from "@/types/database";

/** ESPN player profile URL, or null for DEF (team defenses use negative ESPN ids with no player page). */
export function espnProfileUrl(player: Player): string | null {
  if (!player.espn_id || player.espn_id.startsWith("-")) return null;
  return `https://www.espn.com/nfl/player/_/id/${player.espn_id}`;
}
