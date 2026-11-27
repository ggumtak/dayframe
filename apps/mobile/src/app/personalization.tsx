import { router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button, Card, Chip, Divider, Header, IconButton, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useNewTaskDate } from '@/data/session';
import { useProjects } from '@/data/tasks';
import { useScreenContext } from '@/features/keyboard';
import {
  DEFAULT_QUICK_ADD_PRESETS,
  MAX_QUICK_ADD_PRESETS,
  type StartOfWeek,
  type SwipeAction,
  type SwipeRightSecondary,
  type TimeFormat,
  type TodayHabitsPosition,
} from '@/features/settings/prefs';
import { resetPersonalPrefs, setPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import { redrawWidgets } from '@/features/widget/render';
import { haptic, setHapticsEnabled, useHapticsEnabled } from '@/lib/haptics';
import type { NewTaskDate } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const DAY_START_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: '0시' },
  { value: 1, label: '새벽 1시' },
  { value: 2, label: '새벽 2시' },
  { value: 3, label: '새벽 3시' },
  { value: 4, label: '새벽 4시' },
  { value: 5, label: '새벽 5시' },
];

const SWIPE_LEFT_OPTIONS: readonly { value: SwipeAction; label: string }[] = [
  { value: 'complete', label: '완료' },
  { value: 'tomorrow', label: '내일로' },
  { value: 'schedule', label: '일정 변경' },
  { value: 'focus', label: '집중 시작' },
  { value: 'none', label: '끄기' },
];

const SWIPE_RIGHT_PRIMARY_OPTIONS: readonly { value: SwipeAction; label: string }[] = [
  { value: 'schedule', label: '일정 변경' },
  { value: 'tomorrow', label: '내일로' },
  { value: 'focus', label: '집중 시작' },
  { value: 'complete', label: '완료' },
  { value: 'none', label: '끄기' },
];

const SWIPE_RIGHT_SECONDARY_OPTIONS: readonly { value: SwipeRightSecondary; label: string }[] = [
  { value: 'delete', label: '삭제' },
  { value: 'tomorrow', label: '내일로' },
  { value: 'schedule', label: '일정 변경' },
  { value: 'focus', label: '집중 시작' },
  { value: 'none', label: '끄기' },
];

const FOCUS_GOAL_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: '끄기' },
  { value: 30, label: '30분' },
  { value: 60, label: '60분' },
  { value: 90, label: '90분' },
  { value: 120, label: '120분' },
  { value: 180, label: '180분' },
];

function scheduleWidgetRedraw() {
  setTimeout(() => {
    void redrawWidgets();
  }, 80);
}

/** 맞춤 설정: single-user control center for day boundary, gestures, Today layout, quick add, focus & keyboard. */
export default function Personalization() {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const hapticsOn = useHapticsEnabled();
  const [newTaskDate, setNewTaskDate] = useNewTaskDate();
  const { data: projects } = useProjects();

  const [presetInput, setPresetInput] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useScreenContext('settings');

  const sortedProjects = useMemo(
    () => (projects ?? []).slice().sort((a, b) => a.position - b.position),
    [projects],
  );

  const activeProjectId = useMemo(() => {
    if (!prefs.quickAddDefaultProjectId) return null;
    if (!projects) return prefs.quickAddDefaultProjectId;
    return sortedProjects.some((project) => project.id === prefs.quickAddDefaultProjectId)
      ? prefs.quickAddDefaultProjectId
      : null;
  }, [prefs.quickAddDefaultProjectId, projects, sortedProjects]);

  const presetsAreDefault =
    prefs.quickAddPresets.length === DEFAULT_QUICK_ADD_PRESETS.length
    && prefs.quickAddPresets.every((item, idx) => item === DEFAULT_QUICK_ADD_PRESETS[idx]);

  const dayStartValue = prefs.dayStartHour === 0 ? '0시' : `새벽 ${prefs.dayStartHour}시까지 오늘`;

  const addPreset = () => {
    const token = presetInput.trim().slice(0, 40);
    if (!token) return;
    if (prefs.quickAddPresets.includes(token)) {
      showToast('이미 등록된 칩입니다.');
      return;
    }
    if (prefs.quickAddPresets.length >= MAX_QUICK_ADD_PRESETS) {
      showToast(`빠른 입력 칩은 최대 ${MAX_QUICK_ADD_PRESETS}개까지 등록할 수 있습니다.`);
      return;
    }
    haptic.tap();
    setPersonalPrefs({ quickAddPresets: [...prefs.quickAddPresets, token] });
    setPresetInput('');
  };

  const removePreset = (token: string) => {
    haptic.tap();
    setPersonalPrefs({
      quickAddPresets: prefs.quickAddPresets.filter((item) => item !== token),
    });
  };

  const handleResetAll = () => {
    setConfirmReset(false);
    void resetPersonalPrefs().then(() => {
      scheduleWidgetRedraw();
    });
    setHapticsEnabled(true);
    setNewTaskDate('today');
    haptic.success();
    showToast('맞춤 설정을 기본값으로 되돌렸습니다.');
  };

  return (
    <Screen>
      <Header title="맞춤 설정" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>

        <Group title="시간">
          <Card style={styles.card}>
            <View style={styles.block}>
              <View style={styles.labelRow}>
                <Txt variant="bodyStrong">하루 시작</Txt>
                <Txt variant="caption" tone="muted" tabular>{dayStartValue}</Txt>
              </View>
              <View style={styles.chips}>
                {DAY_START_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={prefs.dayStartHour === option.value}
                    onPress={() => {
                      setPersonalPrefs({ dayStartHour: option.value });
                      scheduleWidgetRedraw();
                    }} />
                ))}
              </View>
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">주 시작</Txt>
              <Segmented<StartOfWeek>
                value={prefs.startOfWeek}
                onChange={(startOfWeek) => {
                  setPersonalPrefs({ startOfWeek });
                  scheduleWidgetRedraw();
                }}
                options={[
                  { value: 'monday', label: '월요일' },
                  { value: 'sunday', label: '일요일' },
                ]} />
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">시간</Txt>
              <Segmented<TimeFormat>
                value={prefs.timeFormat}
                onChange={(timeFormat) => {
                  setPersonalPrefs({ timeFormat });
                  scheduleWidgetRedraw();
                }}
                options={[
                  { value: '12h', label: '12시간' },
                  { value: '24h', label: '24시간' },
                ]} />
            </View>
          </Card>
        </Group>

        <Group title="제스처">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">오른쪽 스와이프</Txt>
              <View style={styles.chips}>
                {SWIPE_LEFT_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={prefs.swipeLeft === option.value}
                    onPress={() => setPersonalPrefs({ swipeLeft: option.value })} />
                ))}
              </View>
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">왼쪽 스와이프 1</Txt>
              <View style={styles.chips}>
                {SWIPE_RIGHT_PRIMARY_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={prefs.swipeRightPrimary === option.value}
                    onPress={() => setPersonalPrefs({ swipeRightPrimary: option.value })} />
                ))}
              </View>
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">왼쪽 스와이프 2</Txt>
              <View style={styles.chips}>
                {SWIPE_RIGHT_SECONDARY_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={prefs.swipeRightSecondary === option.value}
                    onPress={() => setPersonalPrefs({ swipeRightSecondary: option.value })} />
                ))}
              </View>
            </View>

            <Divider />

            <ToggleRow
              label="진동 피드백"
              value={hapticsOn}
              onValueChange={(next) => {
                setHapticsEnabled(next);
                if (next) haptic.tap();
              }} />
          </Card>
        </Group>

        <Group title="오늘 화면">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">습관 위치</Txt>
              <Segmented<TodayHabitsPosition>
                value={prefs.todayHabitsPosition}
                onChange={(todayHabitsPosition) => setPersonalPrefs({ todayHabitsPosition })}
                options={[
                  { value: 'top', label: '상단' },
                  { value: 'bottom', label: '하단' },
                  { value: 'hidden', label: '숨김' },
                ]} />
            </View>

            <Divider />

            <ToggleRow
              label="상단 진행률 바"
              value={prefs.showTodayFocusStrip}
              onValueChange={(showTodayFocusStrip) => setPersonalPrefs({ showTodayFocusStrip })} />

            <Divider />

            <ToggleRow
              label="완료 일러스트"
              value={prefs.showAllDoneArt}
              onValueChange={(showAllDoneArt) => setPersonalPrefs({ showAllDoneArt })} />
          </Card>
        </Group>

        <Group title="빠른 추가">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">기본 마감일</Txt>
              <Segmented<NewTaskDate>
                value={newTaskDate}
                onChange={setNewTaskDate}
                options={[
                  { value: 'today', label: '오늘', icon: 'sun' },
                  { value: 'none', label: '없음', icon: 'list' },
                ]} />
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">기본 목록</Txt>
              <View style={styles.chips}>
                <Chip
                  label="미분류"
                  selected={activeProjectId === null}
                  onPress={() => setPersonalPrefs({ quickAddDefaultProjectId: null })} />
                {sortedProjects.map((project) => (
                  <Chip
                    key={project.id}
                    label={project.name}
                    icon="hash"
                    selected={activeProjectId === project.id}
                    onPress={() => setPersonalPrefs({ quickAddDefaultProjectId: project.id })} />
                ))}
              </View>
            </View>

            <Divider />

            <ToggleRow
              label="연속 추가"
              value={prefs.quickAddKeepOpen}
              onValueChange={(quickAddKeepOpen) => setPersonalPrefs({ quickAddKeepOpen })} />

            <Divider />

            <View style={styles.block}>
              <View style={styles.labelRow}>
                <Txt variant="bodyStrong">빠른 입력 칩</Txt>
                <Txt variant="caption" tone="faint" tabular>
                  {prefs.quickAddPresets.length}/{MAX_QUICK_ADD_PRESETS}
                </Txt>
              </View>
              {prefs.quickAddPresets.length > 0 ? (
                <View style={styles.chips}>
                  {prefs.quickAddPresets.map((token) => (
                    <Chip
                      key={token}
                      label={`${token} ×`}
                      tone="set"
                      onPress={() => removePreset(token)} />
                  ))}
                </View>
              ) : (
                <Txt variant="small" tone="faint">등록된 칩 없음</Txt>
              )}
              <View style={styles.presetInputRow}>
                <TextInput
                  value={presetInput}
                  onChangeText={setPresetInput}
                  onSubmitEditing={addPreset}
                  returnKeyType="done"
                  maxLength={40}
                  accessibilityLabel="빠른 입력 칩 추가"
                  placeholder="#업무, 오후 2시, 15분간"
                  placeholderTextColor={colors.textFaint}
                  style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text, fontFamily }]} />
                <Button
                  label="추가"
                  kind="secondary"
                  disabled={!presetInput.trim() || prefs.quickAddPresets.length >= MAX_QUICK_ADD_PRESETS}
                  onPress={addPreset}
                  style={styles.addBtn} />
              </View>
              {!presetsAreDefault ? (
                <Button
                  label="기본 칩 복원"
                  kind="ghost"
                  icon="rotate-ccw"
                  onPress={() => {
                    haptic.tap();
                    setPersonalPrefs({ quickAddPresets: [...DEFAULT_QUICK_ADD_PRESETS] });
                  }}
                  style={styles.resetPresetsBtn} />
              ) : null}
            </View>
          </Card>
        </Group>

        <Group title="집중">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">하루 목표</Txt>
              <View style={styles.chips}>
                {FOCUS_GOAL_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    selected={prefs.focusDailyGoalMinutes === option.value}
                    onPress={() => setPersonalPrefs({ focusDailyGoalMinutes: option.value })} />
                ))}
              </View>
            </View>

            <Divider />

            <ToggleRow
              label="화면 켜짐 유지"
              value={prefs.focusKeepAwake}
              onValueChange={(focusKeepAwake) => setPersonalPrefs({ focusKeepAwake })} />
          </Card>
        </Group>

        <Group title="키보드">
          <Card style={styles.card}>
            <ToggleRow
              label="단일 키 단축키"
              value={prefs.singleKeyShortcuts}
              onValueChange={(singleKeyShortcuts) => setPersonalPrefs({ singleKeyShortcuts })} />
          </Card>
        </Group>

        <Button
          label="기본값으로 초기화"
          kind="danger"
          icon="rotate-ccw"
          onPress={() => setConfirmReset(true)} />
      </ScrollView>

      <Sheet visible={confirmReset} onClose={() => setConfirmReset(false)} title="맞춤 설정을 초기화할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          모든 맞춤 설정이 기본값으로 되돌아갑니다.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button label="기본값으로 초기화" kind="danger" onPress={handleResetAll} />
          <Button label="취소" kind="secondary" onPress={() => setConfirmReset(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="section" tone="muted" accessibilityRole="header">{title}</Txt>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptic.tap();
        onValueChange(!value);
      }}
      style={styles.toggleRow}>
      <Txt variant="bodyStrong" style={{ flex: 1 }}>{label}</Txt>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.accent, false: colors.control }}
        thumbColor={colors.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: space.md, gap: space.md },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  presetInputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 42, fontSize: 14 },
  addBtn: { minHeight: 42, paddingHorizontal: space.md },
  resetPresetsBtn: { alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: space.sm },
});
