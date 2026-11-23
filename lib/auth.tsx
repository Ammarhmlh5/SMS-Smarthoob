import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isLocalApiConfigured, isSupabaseConfigured, supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    let active = true;
    const initializeSession = async () => {
      try {
        if (isLocalApiConfigured) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: 'local@localhost',
            password: 'local',
          });
          if (error) throw error;
          if (active) setSession(data.session);
        } else if (isSupabaseConfigured) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (active) setSession(data.session);
        }
      } catch (error) {
        console.error('Unable to initialize the application session:', error);
      } finally {
        if (active) setLoading(false);
      }
    };
    void initializeSession();

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, loading }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
