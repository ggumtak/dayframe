import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery, focusManager, MutationCache, onlineManager, QueryCache, QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { AppState, Platform } from 'react-native';

import { ApiFailure, errorMessage, isPermanentFailure } from '@/lib/api';
import { auth } from '@/lib/auth';
import { showToast } from '@/lib/toast';

const WEEK = 7 * 24 * 60 * 60 * 1000;

// Writes pause while the device is offline and resume, in order, when it reconnects.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
}

function handleFailure(error: unknown) {
  // A rejected refresh token cannot recover on its own; return to the sign-in screen.
  if (error instanceof ApiFailure && error.status === 401) void auth.signOut({ scope: 'local' });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleFailure }),
  mutationCache: new MutationCache({
    onError: (error) => {
      handleFailure(error);
      showToast(errorMessage(error), { tone: 'error' });
      // Optimistic edits may no longer match the server, so reload what the screen shows.
      void queryClient.invalidateQueries();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: WEEK,
      retry: (count, error) => !(error instanceof ApiFailure && error.status < 500) && count < 2,
    },
    mutations: {
      gcTime: WEEK,
      retry: (count, error) => !isPermanentFailure(error) && count < 3,
    },
  },
});

export const CACHE_KEY = 'dayframe-query-cache';

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 1000 }),
  maxAge: WEEK,
  buster: 'v1',
  // Queries can opt out of the on-disk cache with `meta: { persist: false }`.
  dehydrateOptions: { shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && query.meta?.persist !== false },
};

/** Forgets one account's data before another signs in on the same device. */
export async function clearLocalData(): Promise<void> {
  queryClient.getMutationCache().clear();
  queryClient.clear();
  await AsyncStorage.removeItem(CACHE_KEY);
}
