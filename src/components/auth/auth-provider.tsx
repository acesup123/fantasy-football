"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface Owner {
  id: string;
  name: string;
  team_name: string;
  email: string | null;
  is_commissioner: boolean;
}

export interface SignInResult {
  error: string | null;
  /** Supabase error code, e.g. "over_email_send_rate_limit". */
  code: string | null;
  /** Seconds to wait before retrying, when the server tells us. */
  retryAfter: number | null;
  /** Whether this attempt consumed an email send and should start a cooldown. */
  throttle: boolean;
}

interface AuthContextType {
  user: User | null;
  owner: Owner | null;
  loading: boolean;
  isAdmin: boolean;
  adminMode: boolean;
  toggleAdminMode: () => void;
  signIn: (email: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  owner: null,
  loading: true,
  isAdmin: false,
  adminMode: false,
  toggleAdminMode: () => {},
  signIn: async () => ({ error: null, code: null, retryAfter: null, throttle: false }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminMode, setAdminMode] = useState(false);
  const supabase = createClient();

  // Load user and match to owner
  const loadUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);

    if (user?.email) {
      const { data: ownerData } = await supabase
        .from("owners")
        .select("id, name, team_name, email, is_commissioner")
        .eq("email", user.email)
        .single();

      setOwner(ownerData);
    } else {
      setOwner(null);
      setAdminMode(false);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (!session?.user) {
          setOwner(null);
          setAdminMode(false);
        }
        loadUser();
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase, loadUser]);

  const isAdmin = owner?.is_commissioner ?? false;

  const toggleAdminMode = useCallback(() => {
    if (isAdmin) {
      setAdminMode((prev) => !prev);
    }
  }, [isAdmin]);

  /**
   * Routed through the server so league membership is checked before any email
   * is sent — signInWithOtp creates a user for any address by default, and
   * every table is readable by any authenticated session.
   */
  const signIn = useCallback(async (email: string): Promise<SignInResult> => {
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const payload = await res.json().catch(() => ({}));

      if (res.ok) {
        return { error: null, code: null, retryAfter: null, throttle: true };
      }

      return {
        error: payload.error ?? 'Could not send the sign-in link. Try again.',
        code: payload.code ?? null,
        retryAfter: payload.retryAfter ?? null,
        throttle: payload.throttle ?? true,
      };
    } catch {
      return {
        error: 'Could not reach the server. Check your connection and try again.',
        code: null,
        retryAfter: null,
        throttle: false,
      };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setOwner(null);
    setAdminMode(false);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        owner,
        loading,
        isAdmin,
        adminMode,
        toggleAdminMode,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
