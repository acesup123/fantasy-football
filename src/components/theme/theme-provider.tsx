"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/auth-provider";
import { DEFAULT_THEME, isTheme, type ResolvedTheme } from "@/lib/theme";
import {
  getServerSnapshot,
  getSnapshot,
  getSystemServerSnapshot,
  getSystemSnapshot,
  setStoredTheme,
  subscribe,
  subscribeSystem,
} from "@/components/theme/theme-store";
import type { Theme } from "@/types/database";

interface ThemeContextType {
  /** What the owner chose — may be "system". */
  theme: Theme;
  /** Which palette is actually painted right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** False during SSR and hydration, when the stored choice isn't readable yet. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  resolvedTheme: "dark",
  setTheme: () => {},
  ready: false,
});

const clientReady = () => true;
const serverReady = () => false;

/**
 * Applies the theme to <html> and persists it per owner.
 *
 * Storage is two-tier on purpose:
 *  - localStorage is what the pre-paint script in layout.tsx reads, so it has
 *    to stay in sync on every change or the next load flashes the old palette.
 *  - owner_preferences is the cross-device source of truth. On sign-in the DB
 *    value wins over whatever this device had cached.
 *
 * Signed-out visitors (the login page) still get a working toggle — it just
 * lives in localStorage until there is an owner row to attach it to.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { owner } = useAuth();
  const ownerId = owner?.id ?? null;
  const supabase = createClient();

  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const systemPreference = useSyncExternalStore(
    subscribeSystem,
    getSystemSnapshot,
    getSystemServerSnapshot
  );
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemPreference : theme;

  // Keep <html> in step with the resolved choice. The pre-paint script sets the
  // same attribute, so on first load this is a no-op write.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  // Which owner's preference has already been pulled. Guards against the fetch
  // re-running on every auth refresh and clobbering a fresh local choice.
  const loadedOwnerId = useRef<string | null>(null);

  useEffect(() => {
    // Signed out — let the next sign-in re-fetch.
    if (!ownerId) {
      loadedOwnerId.current = null;
      return;
    }

    if (loadedOwnerId.current === ownerId) return;
    loadedOwnerId.current = ownerId;

    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase
          .from("owner_preferences")
          .select("theme")
          .eq("owner_id", ownerId)
          .maybeSingle();

        // No row yet just means this owner has never changed the default.
        if (!cancelled && isTheme(data?.theme)) setStoredTheme(data.theme);
      } catch {
        // Offline, or the migration hasn't been applied yet. The locally
        // cached preference stays in effect either way.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerId, supabase]);

  const setTheme = useCallback(
    (next: Theme) => {
      setStoredTheme(next);

      if (!ownerId) return;

      // Fire-and-forget: a failed write costs the cross-device sync, not the
      // theme itself, which is already applied and cached locally. Swallowing
      // the rejection keeps a dropped connection from surfacing as an
      // unhandled rejection — PostgREST errors resolve rather than throw, so
      // this only catches transport failures.
      void supabase
        .from("owner_preferences")
        .upsert(
          {
            owner_id: ownerId,
            theme: next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_id" }
        )
        .then(undefined, () => {});
    },
    [ownerId, supabase]
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, ready }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
