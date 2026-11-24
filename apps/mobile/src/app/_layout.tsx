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
import { QuickAddProvider, TAB_BAR_HEIGHT, useQuickAdd } from '@/features/quick-add/QuickAdd';
import { BackgroundSync } from '@/features/reminders/BackgroundSync';
import { UpdateProvider } from '@/features/update/useUpdate';
import { isConfigured } from '@/lib/env';
import { LayoutProvider, useLayout } from '@/lib/layoutContext';
import { keepPhonesPortrait } from '@/lib/orientation';
import { runSelfCheck } from '@/lib/selfCheck';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();
keepPhonesPortrait();
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
        <Stack.Screen name="habit/overview" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="appearance" />
        <Stack.Screen name="tab-bar" />
        <Stack.Screen name="ai" />
        <Stack.Screen name="ai-key" />
        <Stack.Screen name="assistant/index" />
        <Stack.Screen name="assistant/organize" />
        <Stack.Screen name="assistant/plan" />
        <Stack.Screen name="assistant/breakdown" />
        <Stack.Screen name="assistant/review" />
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

function SignedInToast() {
  const { fabHidden } = useQuickAdd();
  const { column } = useLayout();
  // Lifts above BatchBar when multi-select hides the FAB, and leaves room for the FAB otherwise; on a tablet it
  // stays inside the centred column.
  return (
    <ToastHost
      bottomOffset={fabHidden ? TAB_BAR_HEIGHT + 92 : TAB_BAR_HEIGHT} rightInset={column.inset + (fabHidden ? 0 : 70)} leftInset={column.inset} />
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
        {signedIn ? (
          <QuickAddProvider>
            <Routes signedIn />
            <BackgroundSync />
            <SignedInToast />
          </QuickAddProvider>
        ) : (
          <>
            <Routes signedIn={false} />
            <ToastHost bottomOffset={0} rightInset={0} />
          </>
        )}
      </UpdateProvider>
    </NavigationTheme>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LayoutProvider>
          <ThemeProvider>
            <PersistQueryClientProvider
              client={queryClient} persistOptions={persistOptions}
              onSuccess={() => void resumeWrites()}>
              <SessionProvider>
                <App />
              </SessionProvider>
            </PersistQueryClientProvider>
          </ThemeProvider>
        </LayoutProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
