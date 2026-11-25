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
  { value: 0, label: '자정 (0시)' },
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

/** 내 맞춤 설정: single-user control center for day boundary, gestures, Today layout, quick add, focus & keyboard. */
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
      <Header title="내 맞춤 설정" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>

        <Group title="시간 · 하루 기준">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">하루 시작 시각 (야행성 기준)</Txt>
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
              <Txt variant="small" tone="muted">
                새벽 2시로 설정하면 새벽 1시 50분에도 &apos;오늘&apos; 할 일과 습관이 그대로 유지됩니다.
              </Txt>
            </View>

            <Divider />

            <View style={styles.block}>
              <Txt variant="bodyStrong">주 시작 요일</Txt>
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
              <Txt variant="bodyStrong">시간 표시</Txt>
              <Segmented<TimeFormat>
                value={prefs.timeFormat}
                onChange={(timeFormat) => {
                  setPersonalPrefs({ timeFormat });
                  scheduleWidgetRedraw();
                }}
                options={[
                  { value: '12h', label: '오전/오후 (12시간)' },
                  { value: '24h', label: '24시간' },
                ]} />
            </View>
          </Card>
        </Group>

        <Group title="스와이프 · 터치 제스처">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">오른쪽으로 밀기 (좌→우)</Txt>
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
              <Txt variant="bodyStrong">왼쪽으로 밀기 1번 (우→좌)</Txt>
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
              <Txt variant="bodyStrong">왼쪽으로 밀기 2번</Txt>
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
              description="버튼 탭, 완료 체크, 제스처 시 가벼운 진동으로 반응합니다."
              value={hapticsOn}
              onValueChange={(next) => {
                setHapticsEnabled(next);
                if (next) haptic.tap();
              }} />
          </Card>
        </Group>

        <Group title="오늘 화면 구성">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">오늘의 습관 위치</Txt>
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
              label="오늘 집중·시간 예산 바"
              description="오늘 화면 상단에 집중 시간과 예정 소요 시간 요약을 보여줍니다."
              value={prefs.showTodayFocusStrip}
              onValueChange={(showTodayFocusStrip) => setPersonalPrefs({ showTodayFocusStrip })} />

            <Divider />

            <ToggleRow
              label="모두 완료 일러스트"
              description="오늘 할 일을 모두 마쳤을 때 완료 일러스트를 보여줍니다."
              value={prefs.showAllDoneArt}
              onValueChange={(showAllDoneArt) => setPersonalPrefs({ showAllDoneArt })} />
          </Card>
        </Group>

        <Group title="빠른 추가 기본값">
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
              <Txt variant="small" tone="muted">
                {newTaskDate === 'today'
                  ? '날짜를 입력하지 않아도 오늘 할 일로 추가됩니다. 입력창에서 ‘오늘 ×’를 눌러 해제할 수 있습니다.'
                  : '날짜를 입력하지 않으면 목록 탭에만 저장됩니다. 오늘 탭에서 추가할 때는 오늘 날짜로 지정됩니다.'}
              </Txt>
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
              label="연속 추가 기본 켜기"
              description="할 일을 저장한 뒤에도 빠른 추가 입력창을 닫지 않고 계속 입력합니다."
              value={prefs.quickAddKeepOpen}
              onValueChange={(quickAddKeepOpen) => setPersonalPrefs({ quickAddKeepOpen })} />

            <Divider />

            <View style={styles.block}>
              <View style={styles.presetHeader}>
                <Txt variant="bodyStrong">나만의 빠른 입력 칩</Txt>
                <Txt variant="caption" tone="faint" tabular>
                  {prefs.quickAddPresets.length}/{MAX_QUICK_ADD_PRESETS}
                </Txt>
              </View>
              <Txt variant="small" tone="muted">
                자주 쓰는 토큰을 등록해 두면 빠른 추가에서 한 번에 넣을 수 있습니다. 칩을 누르면 제거됩니다.
              </Txt>
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
                <Txt variant="small" tone="faint">등록된 칩이 없습니다.</Txt>
              )}
              <View style={styles.presetInputRow}>
                <TextInput
                  value={presetInput}
                  onChangeText={setPresetInput}
                  onSubmitEditing={addPreset}
                  returnKeyType="done"
                  maxLength={40}
                  accessibilityLabel="빠른 입력 칩 추가"
                  placeholder="예: #업무, 오후 2시, 15분간, @집"
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
                  label="기본 칩으로 복원"
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

        <Group title="집중 · 키보드">
          <Card style={styles.card}>
            <View style={styles.block}>
              <Txt variant="bodyStrong">하루 집중 목표</Txt>
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
              label="집중 중 화면 켜짐 유지"
              description="타이머가 실행되는 동안 기기 화면이 자동으로 꺼지지 않도록 유지합니다."
              value={prefs.focusKeepAwake}
              onValueChange={(focusKeepAwake) => setPersonalPrefs({ focusKeepAwake })} />

            <Divider />

            <ToggleRow
              label="외부 키보드 단일 키 단축키"
              description="끄면 Ctrl+K, ?, Esc 등 조합·제어 키만 동작합니다."
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
          하루 시작 시각, 제스처, 오늘 화면 구성, 빠른 입력 칩, 집중·키보드 설정이 모두 기본값으로 되돌아갑니다.
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

function ToggleRow({ label, description, value, onValueChange }: {
  label: string;
  description?: string;
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
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{label}</Txt>
        {description ? <Txt variant="small" tone="muted">{description}</Txt> : null}
      </View>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  presetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  presetInputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 42, fontSize: 14 },
  addBtn: { minHeight: 42, paddingHorizontal: space.md },
  resetPresetsBtn: { alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: space.sm },
});
