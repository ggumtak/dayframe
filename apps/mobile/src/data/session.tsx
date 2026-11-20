import type { Session } from '@supabase/auth-js';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { auth } from '@/lib/auth';
import { deviceTimeZone } from '@/lib/dates';
import { isConfigured } from '@/lib/env';

import { clearLocalData, queryClient } from './client';
import { keys } from './keys';

interface SessionValue { session: Session | null; isLoading: boolean; signOut: () => Promise<void> }

const SessionContext = createContext<SessionValue>({ session: null, isLoading: true, signOut: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    let userId: string | null | undefined;
    const { data } = auth.onAuthStateChange((_event, next) => {
      const nextId = next?.user.id ?? null;
      // Cached lists belong to one account; never show them to the next person on this device.
      if (userId !== undefined && userId !== nextId) void clearLocalData();
      userId = nextId;
      setSession(next);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionValue>(() => ({
    session, isLoading,
    signOut: async () => {
      await auth.signOut({ scope: 'local' });
      await clearLocalData();
    },
  }), [session, isLoading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/** The profile, with a new account's default time zone set from the device once. */
export function useProfile() {
  const query = useQuery({ queryKey: keys.me, queryFn: api.me });
  const profile = query.data;
  useEffect(() => {
    const zone = deviceTimeZone();
    if (profile?.timezone === 'UTC' && zone !== 'UTC') {
      api.updateMe({ timezone: zone }).then((updated) => queryClient.setQueryData(keys.me, updated)).catch(() => {});
    }
  }, [profile?.timezone]);
  return query;
}
