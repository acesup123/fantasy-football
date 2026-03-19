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

interface AuthContextType {
  user: User | null;
  owner: Owner | null;
  loading: boolean;
  isAdmin: boolean;
  adminMode: boolean;
  toggleAdminMode: () => void;
  signIn: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  owner: null,
  loading: true,
  isAdmin: false,
  adminMode: false,
  toggleAdminMode: () => {},
  signIn: async () => ({ error: null }),
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

  const signIn = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    return { error: error?.message ?? null };
  }, [supabase]);

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
