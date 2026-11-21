// Importing the data modules registers every write's defaults before the saved cache is restored,
// so writes queued while offline in a previous run know how to resume.
import '@/data/focus';
import '@/data/habits';
import '@/data/tasks';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastHost } from '@/components/ToastHost';
import { EmptyState } from '@/components/ui';
import { persistOptions, queryClient, resumeWrites } from '@/data/client';
import { SessionProvider, useSession } from '@/data/session';
import { QuickAddProvider, TAB_BAR_HEIGHT } from '@/features/quick-add/QuickAdd';
import { BackgroundSync } from '@/features/reminders/BackgroundSync';
import { UpdateProvider } from '@/features/update/useUpdate';
import { isConfigured } from '@/lib/env';
import { runSelfCheck } from '@/lib/selfCheck';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();
if (process.env.EXPO_PUBLIC_SELF_CHECK === '1') runSelfCheck();

function Routes({ signedIn }: { signedIn: boolean }) {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="habit/[id]" />
        <Stack.Screen name="habit/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="ai" />
        <Stack.Screen name="add" options={{ animation: 'none' }} />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="completed" />
        <Stack.Screen name="routines" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

function App() {
  const { colors, isDark } = useTheme();
  const { account, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync();
  }, [isLoading]);

  if (!isConfigured) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          icon="cloud-off" title="서버 연결 정보가 없습니다"
          message="이 빌드에는 Supabase 주소와 키가 들어 있지 않습니다. EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_KEY를 설정해 다시 빌드해 주세요." />
      </View>
    );
  }
  if (isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const signedIn = !!account;
  const base = isDark ? DarkTheme : DefaultTheme;
  return (
    <NavigationTheme
      value={{ ...base, colors: { ...base.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent } }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <UpdateProvider>
        {signedIn ? <QuickAddProvider><Routes signedIn /><BackgroundSync /></QuickAddProvider> : <Routes signedIn={false} />}
        {/* Leaves room for the floating add button, which sits to the right at the same height. */}
        <ToastHost bottomOffset={signedIn ? TAB_BAR_HEIGHT : 0} rightInset={signedIn ? 70 : 0} />
      </UpdateProvider>
    </NavigationTheme>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PersistQueryClientProvider
            client={queryClient} persistOptions={persistOptions}
            onSuccess={() => void resumeWrites()}>
            <SessionProvider>
              <App />
            </SessionProvider>
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
