import type { Theme } from "@/types/database";

/** The two palettes globals.css actually defines. "system" resolves to one of these. */
export type ResolvedTheme = "dark" | "light";

/**
 * Mirror of the owner's saved preference, read by the pre-paint script in
 * <head>. The database row is the source of truth across devices; this is what
 * makes the first frame correct before any of that has loaded.
 */
export const THEME_STORAGE_KEY = "banl-theme";

/** Dark is what the league has always seen, so it is the fallback everywhere. */
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}
