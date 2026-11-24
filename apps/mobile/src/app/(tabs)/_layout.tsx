import { onlineManager } from '@tanstack/react-query';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { memo, useMemo, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt } from '@/components/ui';
import { useProfile } from '@/data/session';
import { useTasks } from '@/data/tasks';
import { TAB_BAR_HEIGHT } from '@/features/quick-add/QuickAdd';
import { TAB_ICONS, TAB_LABELS, type TabName, visibleTabs } from '@/features/settings/tabBar';
import { useTabBarConfig } from '@/features/settings/tabBarStore';
import { useMinute } from '@/lib/clock';
import { dueBucket } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { emitTabReselect } from '@/lib/tabScroll';
import { fontFamily, useTheme } from '@/theme';

/**
 * The count of tasks due today or overdue, on the 오늘 icon. It alone follows the task list and the clock,
 * so the bar around it does not re-render every minute.
 */
const TodayBadge = memo(function TodayBadge() {
  const { colors } = useTheme();
  const { data: tasks } = useTasks();
  const minute = useMinute();
  const dueNow = useMemo(
    // `minute` makes the count roll over at midnight.
    () => (minute >= 0 ? (tasks ?? []).filter((task) => { const bucket = dueBucket(task); return bucket === 'overdue' || bucket === 'today'; }).length : 0),
    [tasks, minute],
  );
  if (dueNow === 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.surface }]}>
      <Text style={[styles.badgeText, { color: colors.onAccent }]}>{dueNow > 99 ? '99+' : dueNow}</Text>
    </View>
  );
});

function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const online = useSyncExternalStore((notify) => onlineManager.subscribe(notify), () => onlineManager.isOnline(), () => true);
  const config = useTabBarConfig();
  // The bar follows the order and visibility chosen in 설정 → 탭 바; hidden tabs stay registered as screens.
  const routes = useMemo(() => {
    const byName = new Map(state.routes.map((route) => [route.name, route]));
    return visibleTabs(config).flatMap((name) => byName.get(name) ?? []);
  }, [config, state.routes]);
  const focusedKey = state.routes[state.index]?.key;

  return (
    <View style={{ backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }}>
      {online ? null : (
        <View style={[styles.offline, { backgroundColor: colors.warningSoft }]} accessibilityLiveRegion="polite">
          <Icon name="wifi-off" size={13} color={colors.warning} />
          <Txt variant="caption" style={{ color: colors.warning }}>오프라인 · 변경한 내용은 연결되면 저장됩니다</Txt>
        </View>
      )}
      <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {routes.map((route) => {
          const focused = route.key === focusedKey;
          const label = descriptors[route.key]?.options.title ?? route.name;
          const color = focused ? colors.accent : colors.textFaint;
          return (
            <Pressable
              key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (focused) {
                  haptic.tap();
                  emitTabReselect(route.name);
                } else if (!event.defaultPrevented) {
                  haptic.tap();
                  navigateToTab(route.key);
                }
              }}>
              <View>
                <Icon name={TAB_ICONS[route.name as TabName] ?? 'circle'} size={22} color={color} />
                {route.name === 'index' ? <TodayBadge /> : null}
              </View>
              <Text style={[styles.label, { color, fontWeight: focused ? '700' : '500' }]}>{label}</Text>
            </Pressable>
          );
        })}
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
  tab: { flex: 1, maxWidth: 112, alignItems: 'center', justifyContent: 'center', gap: 3, height: TAB_BAR_HEIGHT },
  label: { fontFamily, fontSize: 11, lineHeight: 14 },
  badge: {
    position: 'absolute', top: -5, right: -12, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { fontFamily, fontSize: 9, fontWeight: '700', lineHeight: 12 },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5 },
});
