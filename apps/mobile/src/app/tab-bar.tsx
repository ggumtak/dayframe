import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Header, Icon, type IconName, IconButton, Screen, Txt } from '@/components/ui';
import {
  DEFAULT_TAB_BAR, isDefaultTabBar, moveTab, setTabHidden, TAB_ICONS, TAB_LABELS, type MovableTab, visibleTabs,
} from '@/features/settings/tabBar';
import { setTabBarConfig, useTabBarConfig } from '@/features/settings/tabBarStore';
import { haptic } from '@/lib/haptics';
import { fontFamily, radius, space, useTheme } from '@/theme';

/** 탭 바: which tabs sit in the bottom bar and in what order. 오늘 always comes first. */
export default function TabBarSettings() {
  const { colors } = useTheme();
  const config = useTabBarConfig();
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
              <Txt variant="small" tone="faint">항상 첫 번째</Txt>
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
                    <Icon name={hidden ? 'circle' : 'check-circle'} size={22} color={hidden ? colors.textFaint : colors.accent} />
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
          <Txt variant="small" tone="muted">숨긴 탭의 화면은 설정의 ‘숨긴 화면’에서 열 수 있습니다.</Txt>
        </View>

        <Button
          label="기본값으로" kind="secondary" icon="rotate-ccw" disabled={isDefaultTabBar(config)}
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
      accessibilityRole="button" accessibilityLabel={`${label} ${direction < 0 ? '앞으로' : '뒤로'} 옮기기`}
      accessibilityState={{ disabled }} disabled={disabled} hitSlop={4}
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
        const color = index === 0 ? colors.accent : colors.textFaint;
        return (
          <View key={tab} style={styles.previewTab}>
            <Icon name={TAB_ICONS[tab]} size={20} color={color} />
            <Text style={[styles.previewLabel, { color, fontWeight: index === 0 ? '700' : '500' }]}>{TAB_LABELS[tab]}</Text>
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
  // Mirrors the real bar: tabs share the width but stop growing, so a short bar stays centred.
  preview: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: 58, borderRadius: radius.lg, borderWidth: 1,
  },
  previewTab: { flex: 1, maxWidth: 112, alignItems: 'center', gap: 3 },
  previewLabel: { fontFamily, fontSize: 11, lineHeight: 14 },
});
