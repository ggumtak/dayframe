import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt } from '@/components/ui';
import { usePendingWriteCount } from '@/data/client';
import { useProfile } from '@/data/session';
import { useTasks } from '@/data/tasks';
import { GlobalFocusMiniBar, useFocusStatus } from '@/features/focus/runtime';
import { TAB_BAR_HEIGHT } from '@/features/quick-add/QuickAdd';
import { parsePersonalPrefs } from '@/features/settings/prefs';
import { getPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import { TAB_ICONS, TAB_LABELS, type TabName, visibleTabs } from '@/features/settings/tabBar';
import { useTabBarConfig } from '@/features/settings/tabBarStore';
import { useMinute } from '@/lib/clock';
import { dueDate, logicalToday, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { emitTabReselect } from '@/lib/tabScroll';
import { fontFamily, radius, useMotion, useTheme } from '@/theme';

const PERSONAL_PREFS_KEY = 'dayframe-personal-prefs-v1';
const LAST_TAB_KEY = 'dayframe-last-tab-v1';
const VALID_TABS: readonly TabName[] = ['index', 'inbox', 'upcoming', 'habits', 'focus'];

function isTabName(value: unknown): value is TabName {
  return typeof value === 'string' && (VALID_TABS as readonly string[]).includes(value);
}

/**
 * The count of tasks due today or overdue, on the 오늘 icon. Respects `todayBadgeMode` and `dayStartHour`
 * (`logicalToday`), and alone follows the task list and the clock so the bar around it does not re-render every minute.
 */
const TodayBadge = memo(function TodayBadge() {
  const { colors } = useTheme();
  const { data: tasks } = useTasks();
  const { todayBadgeMode, dayStartHour } = usePersonalPrefs();
  const minute = useMinute();
  const dueNow = useMemo(() => {
    if (todayBadgeMode === 'off' || minute < 0) return 0;
    const nowInstant = Temporal.Now.instant();
    return (tasks ?? []).filter((task) => {
      const date = dueDate(task);
      if (!date) return false;
      const ref = logicalToday(task.timezone, dayStartHour, nowInstant);
      const cmp = Temporal.PlainDate.compare(date, ref);
      return todayBadgeMode === 'overdue' ? cmp < 0 : cmp <= 0;
    }).length;
  }, [tasks, todayBadgeMode, dayStartHour, minute]);
  if (dueNow === 0) return null;
  return (
    // A count, not an action: neutral ink, so the selected tab stays the bar's only accent.
    <View style={[styles.badge, { backgroundColor: colors.textMuted, borderColor: colors.surface }]}>
      <Text style={[styles.badgeText, { color: colors.surface }]}>{dueNow > 99 ? '99+' : dueNow}</Text>
    </View>
  );
});

/** Subtle pulsing/solid accent dot on the 집중 tab icon whenever a focus timer or rest break is active. */
const FocusRunningDot = memo(function FocusRunningDot() {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const { running, isPaused, onBreak } = useFocusStatus();
  const active = !!running || onBreak;
  const shouldPulse = !!running && !isPaused && !reduced;
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!shouldPulse) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(
      withRepeat(
        withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [shouldPulse, opacity]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!active) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.focusDot,
        { backgroundColor: isPaused ? colors.accentRamp[1] : colors.accent, borderColor: colors.surface },
        pulseStyle,
      ]}
    />
  );
});

function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { reduced } = useMotion();
  const insets = useSafeAreaInsets();
  const online = useSyncExternalStore((notify) => onlineManager.subscribe(notify), () => onlineManager.isOnline(), () => true);
  const pendingWrites = usePendingWriteCount();
  const config = useTabBarConfig();
  // The bar follows the order and visibility chosen in 설정 → 탭 바; hidden tabs stay registered as screens.
  const routes = useMemo(() => {
    const byName = new Map(state.routes.map((route) => [route.name, route]));
    return visibleTabs(config).flatMap((name) => byName.get(name) ?? []);
  }, [config, state.routes]);

  const focusedRoute = state.routes[state.index];
  const focusedKey = focusedRoute?.key;
  const focusedName = focusedRoute?.name;
  const isFocusTab = focusedName === 'focus';

  const initialHasParams = Boolean(focusedRoute?.params && Object.keys(focusedRoute.params as Record<string, unknown>).length > 0);
  const startupSettledRef = useRef(focusedName !== 'index' || initialHasParams);
  const userNavigatedRef = useRef(false);
  const stateRef = useRef(state);
  const navigateRef = useRef(navigateToTab);
  useEffect(() => {
    stateRef.current = state;
    navigateRef.current = navigateToTab;
  });

  // Apply configured startupTab once on initial mount when landing cleanly on the default `/` route.
  useEffect(() => {
    if (startupSettledRef.current) return;
    let active = true;
    AsyncStorage.multiGet([PERSONAL_PREFS_KEY, LAST_TAB_KEY])
      .then((entries) => {
        if (!active || userNavigatedRef.current || startupSettledRef.current) return;
        startupSettledRef.current = true;
        const currentRoute = stateRef.current.routes[stateRef.current.index];
        if (!currentRoute || currentRoute.name !== 'index') return;
        const stored = Object.fromEntries(entries);
        const inMemoryStartup = getPersonalPrefs().startupTab;
        const startupTab = inMemoryStartup !== 'index'
          ? inMemoryStartup
          : parsePersonalPrefs(stored[PERSONAL_PREFS_KEY]).startupTab;
        const targetTab: TabName = startupTab === 'last'
          ? (isTabName(stored[LAST_TAB_KEY]) ? stored[LAST_TAB_KEY] : 'index')
          : startupTab;
        if (targetTab === 'index') return;
        const targetRoute = stateRef.current.routes.find((route) => route.name === targetTab);
        if (targetRoute) navigateRef.current(targetRoute.key);
      })
      .catch(() => {
        startupSettledRef.current = true;
      });
    return () => {
      active = false;
    };
  }, []);

  // Persist the last visited tab so `startupTab: 'last'` resumes where the user left off.
  useEffect(() => {
    if (!startupSettledRef.current) return;
    if (isTabName(focusedName)) {
      AsyncStorage.setItem(LAST_TAB_KEY, focusedName).catch(() => {});
    }
  }, [focusedName]);

  return (
    <View>
      <GlobalFocusMiniBar hidden={isFocusTab} />
      <View style={{ backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }}>
        {online ? null : (
          <View style={[styles.offline, { backgroundColor: colors.surfaceMuted }]} accessibilityLiveRegion="polite">
            <Icon name="wifi-off" size={13} color={colors.textFaint} />
            <Txt variant="caption" tone="muted" tabular>
              {pendingWrites > 0
                ? `오프라인 · 저장 대기 ${pendingWrites}건 · 다시 연결되면 저장됩니다`
                : '오프라인 · 다시 연결되면 자동으로 저장됩니다'}
            </Txt>
          </View>
        )}
        <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]} accessibilityRole="tablist">
          {routes.map((route) => {
            const focused = route.key === focusedKey;
            const label = descriptors[route.key]?.options.title ?? route.name;
            const color = focused ? colors.accentText : colors.textMuted;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: focused }}
                style={({ pressed }) => [
                  styles.tab,
                  pressed && !reduced && styles.tabPressed,
                ]}
                onPress={() => {
                  userNavigatedRef.current = true;
                  startupSettledRef.current = true;
                  const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (focused) {
                    haptic.tap();
                    emitTabReselect(route.name);
                  } else if (!event.defaultPrevented) {
                    haptic.tap();
                    if (isTabName(route.name)) {
                      AsyncStorage.setItem(LAST_TAB_KEY, route.name).catch(() => {});
                    }
                    navigateToTab(route.key);
                  }
                }}>
                <View style={[styles.iconPill, focused && { backgroundColor: colors.accentSoft }]}>
                  <View>
                    <Icon name={TAB_ICONS[route.name as TabName] ?? 'circle'} size={20} color={focused ? color : colors.textFaint} />
                    {route.name === 'index' ? <TodayBadge /> : null}
                    {route.name === 'focus' ? <FocusRunningDot /> : null}
                  </View>
                </View>
                <Text style={[styles.label, { color, fontWeight: focused ? '700' : '500' }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  // Loads the profile once per session, which also sets a new account's time zone.
  useProfile();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: TAB_LABELS.index }} />
      <Tabs.Screen name="inbox" options={{ title: TAB_LABELS.inbox }} />
      <Tabs.Screen name="upcoming" options={{ title: TAB_LABELS.upcoming }} />
      <Tabs.Screen name="habits" options={{ title: TAB_LABELS.habits }} />
      <Tabs.Screen name="focus" options={{ title: TAB_LABELS.focus }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // With fewer tabs each one stops growing at a comfortable width and the row stays centred.
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tab: { flex: 1, maxWidth: 112, alignItems: 'center', justifyContent: 'center', gap: 2, height: TAB_BAR_HEIGHT },
  tabPressed: { transform: [{ scale: 0.95 }] },
  iconPill: {
    width: 52,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily, fontSize: 11, lineHeight: 14 },
  badge: {
    position: 'absolute', top: -5, right: -12, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { fontFamily, fontSize: 9, fontWeight: '700', lineHeight: 12, fontVariant: ['tabular-nums'] },
  focusDot: {
    position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5,
  },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5 },
});
