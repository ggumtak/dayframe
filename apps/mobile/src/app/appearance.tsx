import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Card, Chip, Divider, Header, Icon, IconButton, Row, Screen, Segmented, Txt } from '@/components/ui';
import { accentPalette, MODE_LABELS } from '@/features/settings/palettes';
import type { Density } from '@/features/settings/prefs';
import { setPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import { redrawWidgets } from '@/features/widget/render';
import { haptic } from '@/lib/haptics';
import { ACCENTS, radius, space, type ThemeMode, useTheme } from '@/theme';

import widgetQuickAdd from '../../modules/widget-quick-add';

const DENSITY_METRICS: Record<Density, { paddingVertical: number; gap: number; minHeight: number }> = {
  compact: { paddingVertical: 6, gap: 1, minHeight: 40 },
  default: { paddingVertical: 10, gap: 2, minHeight: 48 },
  comfortable: { paddingVertical: 14, gap: 4, minHeight: 56 },
};

/** 외관: light or dark, accent colour, list density, and note preview, with a live preview drawn by the real components. */
export default function Appearance() {
  const { colors, isDark, mode, setMode, accent, setAccent } = useTheme();
  const prefs = usePersonalPrefs();

  return (
    <Screen>
      <Header title="외관" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <Preview density={prefs.density} showNotePreview={prefs.showNotePreview} />

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">화면 모드</Txt>
          <Segmented<ThemeMode>
            value={mode} onChange={setMode}
            options={[
              { value: 'system', label: MODE_LABELS.system, icon: 'smartphone' },
              { value: 'light', label: MODE_LABELS.light, icon: 'sun' },
              { value: 'dark', label: MODE_LABELS.dark, icon: 'moon' },
            ]} />
          {mode === 'system' ? <Txt variant="small" tone="muted">기기의 다크 모드 설정을 따릅니다.</Txt> : null}
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
                      const chosen = accentPalette(palette.id);
                      try {
                        widgetQuickAdd?.setAccentColor(chosen.light.accent, chosen.dark.accent);
                      } catch {
                        // Safe no-op on web or builds without the native overlay module.
                      }
                      setTimeout(() => {
                        void redrawWidgets();
                      }, 80);
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
          <Txt variant="small" tone="muted">주요 버튼과 선택한 탭, 체크 표시, 홈 화면 위젯에 적용됩니다.</Txt>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">표시 밀도</Txt>
          <Segmented<Density>
            value={prefs.density}
            onChange={(density) => setPersonalPrefs({ density })}
            options={[
              { value: 'compact', label: '컴팩트' },
              { value: 'default', label: '기본' },
              { value: 'comfortable', label: '여유롭게' },
            ]} />
          <Card style={styles.noteCard}>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="메모 미리보기"
              accessibilityState={{ checked: prefs.showNotePreview }}
              onPress={() => {
                haptic.tap();
                setPersonalPrefs({ showNotePreview: !prefs.showNotePreview });
              }}
              style={styles.toggleRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">메모 미리보기</Txt>
                <Txt variant="small" tone="muted">목록에서 할 일 제목 아래 메모 첫 줄을 함께 보여줍니다.</Txt>
              </View>
              <Switch
                accessibilityLabel="메모 미리보기"
                value={prefs.showNotePreview}
                onValueChange={(showNotePreview) => setPersonalPrefs({ showNotePreview })}
                trackColor={{ true: colors.accent, false: colors.control }}
                thumbColor={colors.onAccent} />
            </Pressable>
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted" accessibilityRole="header">제스처 · 피드백</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row
              icon="sliders"
              label="맞춤 설정"
              detail="스와이프 · 진동 피드백"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={() => router.push('/personalization')} />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** A live sample of theme, accent, density, and note preview using the app's own components. */
function Preview({ density, showNotePreview }: { density: Density; showNotePreview: boolean }) {
  const { colors } = useTheme();
  const [done, setDone] = useState(false);
  const [doneSecond, setDoneSecond] = useState(false);
  const metrics = DENSITY_METRICS[density];

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="caption" tone="faint">미리보기</Txt>
      <View>
        <View style={[styles.previewRow, { paddingVertical: metrics.paddingVertical, minHeight: metrics.minHeight }]}>
          <Checkbox checked={done} label="미리보기 할 일 완료" onPress={() => setDone((value) => !value)} />
          <View style={{ flex: 1, gap: metrics.gap }}>
            <Txt variant="bodyStrong" tone={done ? 'faint' : 'default'} style={done ? { textDecorationLine: 'line-through' } : undefined}>
              장보기 목록 정리하기
            </Txt>
            {showNotePreview ? (
              <Txt variant="small" tone="faint" numberOfLines={1}>
                우유 1L, 계란 1판, 아보카도 2개
              </Txt>
            ) : null}
            <View style={styles.previewMeta}>
              <Icon name="calendar" size={12} color={colors.textFaint} />
              <Txt variant="small" tone="muted" style={{ fontWeight: '600' }}>오늘 오후 6:00</Txt>
            </View>
          </View>
        </View>
        <Divider inset={34} />
        <View style={[styles.previewRow, { paddingVertical: metrics.paddingVertical, minHeight: metrics.minHeight }]}>
          <Checkbox checked={doneSecond} label="두 번째 미리보기 할 일 완료" onPress={() => setDoneSecond((value) => !value)} />
          <View style={{ flex: 1, gap: metrics.gap }}>
            <Txt variant="bodyStrong" tone={doneSecond ? 'faint' : 'default'} style={doneSecond ? { textDecorationLine: 'line-through' } : undefined}>
              주간 회고 작성하기
            </Txt>
            <View style={styles.previewMeta}>
              <Icon name="clock" size={12} color={colors.textFaint} />
              <Txt variant="small" tone="muted">30분</Txt>
              <Txt variant="small" tone="faint">#업무</Txt>
            </View>
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
  noteCard: { paddingVertical: space.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
});
