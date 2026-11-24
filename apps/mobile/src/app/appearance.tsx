import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Card, Chip, Header, Icon, IconButton, Row, Screen, Segmented, Txt } from '@/components/ui';
import { accentPalette, MODE_LABELS } from '@/features/settings/palettes';
import { haptic, setHapticsEnabled, useHapticsEnabled } from '@/lib/haptics';
import { ACCENTS, radius, space, type ThemeMode, useTheme } from '@/theme';

/** 외관: light or dark, the accent colour, and vibration, with a small preview drawn by the real components. */
export default function Appearance() {
  const { colors, isDark, mode, setMode, accent, setAccent } = useTheme();
  const hapticsOn = useHapticsEnabled();

  return (
    <Screen>
      <Header title="테마" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <Preview />

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">화면 모드</Txt>
          <Segmented<ThemeMode>
            value={mode} onChange={setMode}
            options={[
              { value: 'system', label: MODE_LABELS.system, icon: 'smartphone' },
              { value: 'light', label: MODE_LABELS.light, icon: 'sun' },
              { value: 'dark', label: MODE_LABELS.dark, icon: 'moon' },
            ]} />
          {mode === 'system' ? <Txt variant="small" tone="muted">휴대폰의 다크 모드 설정을 따릅니다.</Txt> : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">강조색</Txt>
          <Card style={styles.swatches}>
            <View style={styles.swatchGrid} accessibilityRole="radiogroup">
              {ACCENTS.map((palette) => {
                const selected = palette.id === accent;
                const fill = accentPalette(palette.id)[isDark ? 'dark' : 'light'].accent;
                return (
                  <Pressable
                    key={palette.id} accessibilityRole="radio" accessibilityLabel={palette.label} accessibilityState={{ selected, checked: selected }}
                    onPress={() => {
                      if (!selected) haptic.tap();
                      setAccent(palette.id);
                    }}
                    style={({ pressed }) => [styles.swatch, pressed && { opacity: 0.7 }]}>
                    <View style={[styles.ring, { borderColor: selected ? fill : 'transparent' }]}>
                      <View style={[styles.dot, { backgroundColor: fill }]}>
                        {selected ? <Icon name="check" size={18} color={colors.onAccent} /> : null}
                      </View>
                    </View>
                    <Txt variant="caption" tone={selected ? 'default' : 'muted'} style={selected ? { fontWeight: '700' } : undefined}>
                      {palette.label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </Card>
          <Txt variant="small" tone="muted">버튼, 선택한 탭, 체크 표시의 색이 바뀝니다. 우선순위와 완료 색은 그대로입니다.</Txt>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">피드백</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row
              icon="smartphone" label="진동 피드백" detail={hapticsOn ? '켜짐' : '꺼짐'}
              trailing={<Icon name={hapticsOn ? 'check-circle' : 'circle'} size={20} color={hapticsOn ? colors.accent : colors.textFaint} />}
              onPress={() => {
                const next = !hapticsOn;
                setHapticsEnabled(next);
                if (next) haptic.tap();
              }} />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** A sample of what the choice looks like, made from the components the app itself uses. */
function Preview() {
  const { colors } = useTheme();
  const [done, setDone] = useState(false);
  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="caption" tone="faint">미리보기</Txt>
      <View style={styles.previewRow}>
        <Checkbox checked={done} color={colors.accent} label="미리보기 할 일 완료" onPress={() => setDone((value) => !value)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" tone={done ? 'faint' : 'default'} style={done ? { textDecorationLine: 'line-through' } : undefined}>
            장보기 목록 정리하기
          </Txt>
          <View style={styles.previewMeta}>
            <Icon name="calendar" size={12} color={colors.schedule} />
            <Txt variant="small" style={{ color: colors.schedule }}>오늘 오후 6:00</Txt>
          </View>
        </View>
      </View>
      <View style={styles.previewMeta}>
        <Chip label="집안일" icon="hash" selected />
        <Chip label="예정" icon="calendar" />
      </View>
      <Button label="할 일 추가" icon="plus" onPress={() => {}} />
    </Card>
  );
}

const styles = StyleSheet.create({
  swatches: { paddingVertical: space.md, paddingHorizontal: space.sm },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: space.md },
  swatch: { width: '25%', alignItems: 'center', gap: 6, minHeight: 64 },
  ring: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
});
