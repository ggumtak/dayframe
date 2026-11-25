import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, Header, Icon, type IconName, IconButton, Screen, Segmented, Txt } from '@/components/ui';
import type { StartupTab, TodayBadgeMode } from '@/features/settings/prefs';
import { setPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import {
  DEFAULT_TAB_BAR, isDefaultTabBar, moveTab, setTabHidden, TAB_ICONS, TAB_LABELS, type MovableTab, visibleTabs,
} from '@/features/settings/tabBar';
import { setTabBarConfig, useTabBarConfig } from '@/features/settings/tabBarStore';
import { haptic } from '@/lib/haptics';
import { fontFamily, radius, space, useTheme } from '@/theme';

const STARTUP_TAB_OPTIONS: readonly { value: StartupTab; label: string; icon: IconName }[] = [
  { value: 'index', label: TAB_LABELS.index, icon: TAB_ICONS.index },
  { value: 'inbox', label: TAB_LABELS.inbox, icon: TAB_ICONS.inbox },
  { value: 'upcoming', label: TAB_LABELS.upcoming, icon: TAB_ICONS.upcoming },
  { value: 'habits', label: TAB_LABELS.habits, icon: TAB_ICONS.habits },
  { value: 'focus', label: TAB_LABELS.focus, icon: TAB_ICONS.focus },
  { value: 'last', label: '마지막으로 본 탭', icon: 'rotate-ccw' },
];

const TODAY_BADGE_OPTIONS: { value: TodayBadgeMode; label: string }[] = [
  { value: 'all', label: '오늘 + 지연' },
  { value: 'overdue', label: '지연만' },
  { value: 'off', label: '표시 안 함' },
];

/** 탭 바: which tabs sit in the bottom bar and in what order. 오늘 always comes first. */
export default function TabBarSettings() {
  const { colors } = useTheme();
  const config = useTabBarConfig();
  const personalPrefs = usePersonalPrefs();
  const last = config.order.length - 1;

  return (
    <Screen>
      <Header title="탭 바" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <BarPreview />

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">탭 순서와 표시</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <View style={styles.row}>
              <Icon name={TAB_ICONS.index} size={20} color={colors.textMuted} />
              <Txt style={{ flex: 1 }}>{TAB_LABELS.index}</Txt>
              <Txt variant="small" tone="faint">첫 번째 고정</Txt>
              <Icon name="lock" size={16} color={colors.textFaint} />
            </View>
            {config.order.map((tab, index) => {
              const hidden = config.hidden.includes(tab);
              const label = TAB_LABELS[tab];
              return (
                <View key={tab} style={[styles.row, { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Pressable
                    accessibilityRole="switch" accessibilityLabel={`${label} 탭 표시`} accessibilityState={{ checked: !hidden }}
                    hitSlop={6}
                    onPress={() => {
                      haptic.tap();
                      setTabBarConfig(setTabHidden(config, tab, !hidden));
                    }}
                    style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}>
                    <Icon name={hidden ? 'circle' : 'check-circle'} size={22} color={hidden ? colors.textFaint : colors.accentText} />
                    <Icon name={TAB_ICONS[tab]} size={20} color={hidden ? colors.textFaint : colors.textMuted} />
                    <Txt tone={hidden ? 'faint' : 'default'} style={{ flex: 1 }}>{label}</Txt>
                    {hidden ? <Txt variant="small" tone="faint">숨김</Txt> : null}
                  </Pressable>
                  <MoveButton tab={tab} label={label} direction={-1} disabled={index === 0} />
                  <MoveButton tab={tab} label={label} direction={1} disabled={index === last} />
                </View>
              );
            })}
          </Card>
          <Txt variant="small" tone="muted">숨긴 탭은 설정의 ‘숨긴 탭’에서 언제든 열 수 있습니다.</Txt>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">기본 시작 화면</Txt>
          <Card style={{ gap: space.sm }}>
            <View style={styles.chipWrap}>
              {STARTUP_TAB_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  icon={option.icon}
                  label={option.label}
                  selected={personalPrefs.startupTab === option.value}
                  onPress={() => setPersonalPrefs({ startupTab: option.value })}
                />
              ))}
            </View>
            <Txt variant="small" tone="muted">앱을 처음 열 때 바로 이동할 화면을 선택합니다.</Txt>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">오늘 탭 배지</Txt>
          <Card style={{ gap: space.sm }}>
            <Segmented<TodayBadgeMode>
              value={personalPrefs.todayBadgeMode}
              options={TODAY_BADGE_OPTIONS}
              onChange={(todayBadgeMode) => setPersonalPrefs({ todayBadgeMode })}
            />
            <Txt variant="small" tone="muted">하단 ‘오늘’ 탭 아이콘 위에 표시할 할 일 개수 기준입니다.</Txt>
          </Card>
        </View>

        <Button
          label="기본 설정으로 되돌리기" kind="secondary" icon="rotate-ccw" disabled={isDefaultTabBar(config)}
          onPress={() => setTabBarConfig(DEFAULT_TAB_BAR)} />
      </ScrollView>
    </Screen>
  );
}

function MoveButton({ tab, label, direction, disabled }: { tab: MovableTab; label: string; direction: -1 | 1; disabled: boolean }) {
  const { colors } = useTheme();
  const config = useTabBarConfig();
  const name: IconName = direction < 0 ? 'chevron-up' : 'chevron-down';
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${label} 탭 ${direction < 0 ? '앞으로' : '뒤로'} 이동`}
      accessibilityState={{ disabled }} disabled={disabled} hitSlop={6}
      onPress={() => {
        haptic.tap();
        setTabBarConfig(moveTab(config, tab, direction));
      }}
      style={({ pressed }) => [styles.move, pressed && { backgroundColor: colors.surfaceMuted }]}>
      <Icon name={name} size={20} color={disabled ? colors.border : colors.textMuted} />
    </Pressable>
  );
}

/** The bar as it will look, drawn small, so a change is visible before going back. */
function BarPreview() {
  const { colors } = useTheme();
  const tabs = visibleTabs(useTabBarConfig());
  return (
    <View
      accessible accessibilityLabel={`탭 바 미리보기: ${tabs.map((tab) => TAB_LABELS[tab]).join(', ')}`}
      style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {tabs.map((tab, index) => {
        const active = index === 0;
        const iconColor = active ? colors.accentText : colors.textFaint;
        const labelColor = active ? colors.accentText : colors.textMuted;
        return (
          <View key={tab} style={styles.previewTab}>
            <View style={[styles.previewPill, active && { backgroundColor: colors.accentSoft }]}>
              <Icon name={TAB_ICONS[tab]} size={20} color={iconColor} />
            </View>
            <Text style={[styles.previewLabel, { color: labelColor, fontWeight: active ? '700' : '500' }]}>{TAB_LABELS[tab]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  move: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Mirrors the real bar: tabs share the width but stop growing, so a short bar stays centred.
  preview: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 58, borderRadius: radius.lg, borderWidth: 1,
  },
  previewTab: { flex: 1, maxWidth: 112, alignItems: 'center', gap: 2 },
  previewPill: { width: 52, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  previewLabel: { fontFamily, fontSize: 11, lineHeight: 14 },
});
