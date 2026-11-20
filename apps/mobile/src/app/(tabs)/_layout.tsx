import { onlineManager } from '@tanstack/react-query';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName, Txt } from '@/components/ui';
import { useProfile } from '@/data/session';
import { useTasks } from '@/data/tasks';
import { TAB_BAR_HEIGHT } from '@/features/quick-add/QuickAdd';
import { useMinute } from '@/lib/clock';
import { dueBucket } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme';

const icons: Record<string, IconName> = { index: 'sun', inbox: 'inbox', upcoming: 'calendar', habits: 'repeat', focus: 'clock' };

function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const online = useSyncExternalStore((notify) => onlineManager.subscribe(notify), () => onlineManager.isOnline(), () => true);
  const { data: tasks } = useTasks();
  useMinute();
  const dueNow = (tasks ?? []).filter((task) => ['overdue', 'today'].includes(dueBucket(task))).length;

  return (
    <View style={{ backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }}>
      {online ? null : (
        <View style={[styles.offline, { backgroundColor: colors.warningSoft }]} accessibilityLiveRegion="polite">
          <Icon name="wifi-off" size={13} color={colors.warning} />
          <Txt variant="caption" style={{ color: colors.warning }}>오프라인 · 변경한 내용은 연결되면 저장됩니다</Txt>
        </View>
      )}
      <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = descriptors[route.key].options.title ?? route.name;
          const color = focused ? colors.accent : colors.textFaint;
          return (
            <Pressable
              key={route.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  haptic.tap();
                  navigateToTab(route.key);
                }
              }}>
              <View>
                <Icon name={icons[route.name] ?? 'circle'} size={22} color={color} />
                {route.name === 'index' && dueNow > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.surface }]}>
                    <Text style={[styles.badgeText, { color: colors.onAccent }]}>{dueNow > 99 ? '99+' : dueNow}</Text>
                  </View>
                ) : null}
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
      <Tabs.Screen name="index" options={{ title: '오늘' }} />
      <Tabs.Screen name="inbox" options={{ title: '받은함' }} />
      <Tabs.Screen name="upcoming" options={{ title: '예정' }} />
      <Tabs.Screen name="habits" options={{ title: '습관' }} />
      <Tabs.Screen name="focus" options={{ title: '집중' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: TAB_BAR_HEIGHT },
  label: { fontSize: 11, lineHeight: 14 },
  badge: {
    position: 'absolute', top: -5, right: -12, minWidth: 17, height: 17, borderRadius: 9, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9, fontWeight: '700', lineHeight: 12 },
  offline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5 },
});
