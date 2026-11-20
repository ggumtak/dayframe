import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { auth, AUTH_STORAGE_KEY } from '@/lib/auth';
import { deviceTimeZone } from '@/lib/dates';
import { isConfigured } from '@/lib/env';

import { clearLocalData, queryClient } from './client';
import { keys } from './keys';

export interface Account { id: string; email: string | null }

interface SessionValue { account: Account | null; isLoading: boolean; signOut: () => Promise<void> }

const SessionContext = createContext<SessionValue>({ account: null, isLoading: true, signOut: async () => {} });
const ACCOUNT_KEY = 'dayframe-account';

/** The account saved on this device, read without the network. */
async function storedAccount(): Promise<Account | null> {
  try {
    const user = JSON.parse((await AsyncStorage.getItem(AUTH_STORAGE_KEY)) ?? 'null')?.user;
    return typeof user?.id === 'string' ? { id: user.id, email: user.email ?? null } : null;
  } catch {
    return null;
  }
}

// Cached lists and queued writes belong to one account. They are wiped only when a different
// account signs in or on an explicit sign-out, never because a token refresh failed while offline.
let ownership: Promise<void> = Promise.resolve();
function claimLocalData(account: Account): Promise<void> {
  ownership = ownership.then(async () => {
    const previous = await AsyncStorage.getItem(ACCOUNT_KEY);
    if (previous && previous !== account.id) await clearLocalData();
    if (previous !== account.id) await AsyncStorage.setItem(ACCOUNT_KEY, account.id);
  }).catch(() => {});
  return ownership;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setLoading] = useState(isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    let settled = false;
    const apply = (next: Account | null) => {
      if (!active) return;
      settled = true;
      if (next) void claimLocalData(next);
      setAccount((current) => (current?.id === next?.id && current?.email === next?.email ? current : next));
      setLoading(false);
    };

    // Show the signed-in app straight from storage; the auth client may spend a long time
    // retrying a token refresh when the device starts up offline.
    void storedAccount().then((stored) => {
      if (stored && !settled) apply(stored);
    });

    const { data } = auth.onAuthStateChange((event, session) => {
      if (session) apply({ id: session.user.id, email: session.user.email ?? null });
      else if (event === 'SIGNED_OUT') apply(null);
      // No session without a sign-out means the refresh could not reach the server: keep what is stored.
      else void storedAccount().then(apply);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionValue>(() => ({
    account, isLoading,
    signOut: async () => {
      await auth.signOut({ scope: 'local' });
      await clearLocalData();
      await AsyncStorage.removeItem(ACCOUNT_KEY);
    },
  }), [account, isLoading]);

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
