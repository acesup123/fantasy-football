"use client";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isTheme,
  type ResolvedTheme,
} from "@/lib/theme";
import type { Theme } from "@/types/database";

/**
 * The theme is external state — it lives in localStorage and on <html>, both of
 * which are written before React boots. Reading it through
 * useSyncExternalStore rather than useState+useEffect is what keeps the first
 * client render correct instead of rendering dark and then correcting.
 */

let current: Theme | null = null; // null until first read from localStorage
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Safari in private mode throws on localStorage access.
  }
  return DEFAULT_THEME;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshots must be referentially stable between emits — Theme is a string. */
export function getSnapshot(): Theme {
  if (current === null) current = read();
  return current;
}

/** Used for SSR and the hydration render, where there is no localStorage. */
export function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

/**
 * Updates the choice and mirrors it to localStorage so the pre-paint script
 * gets it right on the next load. Persisting to the database is the caller's
 * job — this also runs for values read back *from* the database.
 */
export function setStoredTheme(next: Theme): void {
  if (current === next) return;
  current = next;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Non-fatal: the database still holds the preference.
  }

  listeners.forEach((listener) => listener());
}

const SYSTEM_QUERY = "(prefers-color-scheme: light)";

export function subscribeSystem(listener: () => void): () => void {
  const media = window.matchMedia(SYSTEM_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function getSystemSnapshot(): ResolvedTheme {
  return window.matchMedia(SYSTEM_QUERY).matches ? "light" : "dark";
}

export function getSystemServerSnapshot(): ResolvedTheme {
  return "dark";
}
