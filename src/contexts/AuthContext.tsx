
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { getProfile } from "../services/commerce";
import type { Profile } from "../types/commerce";

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  passwordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (name: string, email: string, password: string) => Promise<string | null>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    let active = true;
    let hydrationSequence = 0;

    const hydrate = async (nextSession: Session | null) => {
      if (!active) return;

      const requestSequence = ++hydrationSequence;
      setSession(nextSession);

      if (!nextSession?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const result = await getProfile(nextSession.user.id);

        if (active && requestSequence === hydrationSequence) {
          setProfile(result.error ? null : result.data ?? null);
        }
      } catch {
        if (active && requestSequence === hydrationSequence) {
          setProfile(null);
        }
      } finally {
        if (active && requestSequence === hydrationSequence) {
          setLoading(false);
        }
      }
    };

    void supabase.auth
      .getSession()
      .then(({ data, error }) => hydrate(error ? null : data.session))
      .catch(() => hydrate(null));

    const { data } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (event === "PASSWORD_RECOVERY") {
          setPasswordRecovery(true);
        }

        // Do not reload the app when only user metadata changes.
        if (event === "USER_UPDATED") {
          setSession(nextSession);
          return;
        }

        // Defer Supabase profile queries until after the auth callback returns.
        queueMicrotask(() => void hydrate(nextSession));
      }
    );

    return () => {
      active = false;
      hydrationSequence += 1;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) return;

    const channel = supabase
      .channel(`diane-profile-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        async () => {
          const result = await getProfile(userId);

          if (!result.error) {
            setProfile(result.data);

            if (
              result.data?.active === false &&
              result.data.role === "rider"
            ) {
              await supabase.auth.signOut();
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      passwordRecovery,

      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        return error?.message ?? null;
      },

      signUp: async (name, email, password) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name, role: "customer" },
          },
        });

        return error?.message ?? null;
      },

      requestPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });

        return error?.message ?? null;
      },

      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });

        // Keep the recovery screen visible until the user chooses Return to Sign In.
        return error?.message ?? null;
      },

      refreshProfile: async () => {
        if (!session?.user) return;

        const result = await getProfile(session.user.id);

        if (!result.error) {
          setProfile(result.data);
        }
      },

      signOut: async () => {
        const { error } = await supabase.auth.signOut();

        if (error) throw error;

        setPasswordRecovery(false);
      },
    }),
    [loading, passwordRecovery, profile, session]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
