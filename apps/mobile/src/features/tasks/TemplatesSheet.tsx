import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, Icon, IconButton, Segmented, Sheet, Txt } from '@/components/ui';
import { nextPosition, useProjects, useTaskActions, useTaskIndex } from '@/data/tasks';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { deviceTimeZone, formatDurationMinutes, instantFor, logicalToday } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

import { type ChecklistTemplate, deleteCustomTemplate, restoreCustomTemplate, useChecklistTemplates } from './templates';

type ApplyMode = 'checklist' | 'expand';
type DueChoice = 'today' | 'tomorrow' | 'none';

const APPLY_MODES: { value: ApplyMode; label: string }[] = [
  { value: 'checklist', label: '체크리스트 1개로 추가' },
  { value: 'expand', label: '목록 항목으로 펼치기' },
];

const DUE_CHOICES: { value: DueChoice; label: string; icon: 'sun' | 'sunrise' | 'slash' }[] = [
  { value: 'today', label: '오늘', icon: 'sun' },
  { value: 'tomorrow', label: '내일', icon: 'sunrise' },
  { value: 'none', label: '날짜 없음', icon: 'slash' },
];

/** Reusable checklist templates sheet with interactive pre-apply preview (Apple Reminders / Todoist / TickTick templates). */
export function TemplatesSheet({
  visible, onClose, projectId, sectionId, dueToday,
}: {
  visible: boolean;
  onClose: () => void;
  projectId?: string | null;
  sectionId?: string | null;
  dueToday?: boolean;
}) {
  const { colors } = useTheme();
  const { tasks } = useTaskIndex();
  const { data: projects } = useProjects();
  const personalPrefs = usePersonalPrefs();
  const actions = useTaskActions();
  const { custom, builtin } = useChecklistTemplates();

  const [selected, setSelected] = useState<ChecklistTemplate | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [checkedItems, setCheckedItems] = useState<boolean[]>([]);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [dueChoice, setDueChoice] = useState<DueChoice>(dueToday ? 'today' : 'none');
  const [applyMode, setApplyMode] = useState<ApplyMode>('checklist');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setSelected(null);
      setConfirmDeleteId(null);
    }
  }

  const defaultProjectId = useMemo(() => {
    const candidate = projectId !== undefined ? projectId : personalPrefs.quickAddDefaultProjectId;
    if (!candidate) return null;
    if (projects && !projects.some((p) => p.id === candidate)) return null;
    return candidate;
  }, [projectId, personalPrefs.quickAddDefaultProjectId, projects]);

  const openPreview = (tpl: ChecklistTemplate) => {
    haptic.tap();
    setConfirmDeleteId(null);
    setSelected(tpl);
    setDraftTitle(tpl.title);
    setCheckedItems(tpl.items.map(() => true));
    setTargetProjectId(defaultProjectId);
    setDueChoice(dueToday ? 'today' : 'none');
    setApplyMode('checklist');
  };

  const toggleItem = (index: number) => {
    haptic.tap();
    setCheckedItems((prev) => prev.map((on, i) => (i === index ? !on : on)));
  };

  const selectedItems = selected ? selected.items.filter((_, index) => checkedItems[index] !== false) : [];
  const allChecked = selected ? selected.items.length > 0 && selectedItems.length === selected.items.length : false;

  const toggleAllItems = () => {
    if (!selected) return;
    haptic.tap();
    const next = !allChecked;
    setCheckedItems(selected.items.map(() => next));
  };

  const handleApply = () => {
    if (!selected) return;
    const timezone = deviceTimeZone();
    const todayDate = logicalToday(timezone, personalPrefs.dayStartHour);
    const dueAt = dueChoice === 'today'
      ? instantFor(todayDate, null, timezone)
      : dueChoice === 'tomorrow'
        ? instantFor(todayDate.add({ days: 1 }), null, timezone)
        : null;
    const effectiveProjectId = targetProjectId && (!projects || projects.some((p) => p.id === targetProjectId))
      ? targetProjectId
      : null;
    const effectiveSectionId = effectiveProjectId && effectiveProjectId === projectId && sectionId ? sectionId : null;
    const siblings = tasks.filter((task) => !task.parent_task_id && task.project_id === effectiveProjectId);
    const basePos = nextPosition(siblings);
    const durationPatch = selected.defaultDurationMinutes ? { duration_minutes: selected.defaultDurationMinutes } : {};
    const tagNames = selected.tags ?? [];

    if (applyMode === 'expand') {
      if (selectedItems.length === 0) {
        haptic.warning();
        return;
      }
      selectedItems.forEach((item, index) => {
        actions.create({
          input: {
            title: item,
            priority: selected.priority ?? 4,
            timezone,
            position: basePos + index * 1024,
            ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}),
            ...(effectiveSectionId ? { section_id: effectiveSectionId } : {}),
            ...(dueAt ? { due_at: dueAt, all_day: true } : {}),
            ...durationPatch,
          },
          tagNames,
        });
      });
      haptic.success();
      onClose();
      showToast(`‘${draftTitle.trim() || selected.title}’ 항목 ${selectedItems.length}개를 추가했습니다.`);
      return;
    }

    const finalTitle = draftTitle.trim() || selected.title;
    const parentId = actions.create({
      input: {
        title: finalTitle,
        notes: selected.notes ?? null,
        priority: selected.priority ?? 4,
        timezone,
        position: basePos,
        ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}),
        ...(effectiveSectionId ? { section_id: effectiveSectionId } : {}),
        ...(dueAt ? { due_at: dueAt, all_day: true } : {}),
        ...durationPatch,
      },
      tagNames,
    });
    selectedItems.forEach((item, index) => {
      actions.create({
        input: {
          title: item,
          priority: 4,
          timezone,
          position: (index + 1) * 1024,
          parent_task_id: parentId,
        },
      });
    });
    haptic.success();
    onClose();
    showToast(
      selectedItems.length > 0
        ? `‘${finalTitle}’${josa(finalTitle, '와/과')} 하위 작업 ${selectedItems.length}개를 추가했습니다.`
        : `‘${finalTitle}’${josa(finalTitle, '을/를')} 추가했습니다.`,
      {
        actionLabel: '보기',
        onAction: () => router.push({ pathname: '/task/[id]', params: { id: parentId } }),
      },
    );
  };

  const confirmDelete = (tpl: ChecklistTemplate, index: number) => {
    haptic.warning();
    setConfirmDeleteId(null);
    deleteCustomTemplate(tpl.id);
    showToast(`‘${tpl.title}’ 템플릿을 삭제했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => restoreCustomTemplate(tpl, index),
    });
  };

  const renderItem = (tpl: ChecklistTemplate, index: number) => {
    const confirming = !tpl.builtin && confirmDeleteId === tpl.id;
    const metaParts = [
      `하위 작업 ${tpl.items.length}개`,
      tpl.defaultDurationMinutes ? formatDurationMinutes(tpl.defaultDurationMinutes) : null,
      tpl.items.length > 0 ? tpl.items.slice(0, 3).join(', ') : null,
    ].filter(Boolean);

    return (
      <Pressable
        key={tpl.id}
        accessibilityRole="button"
        accessibilityLabel={tpl.title + ' 템플릿 적용'}
        onPress={() => openPreview(tpl)}
        style={({ pressed }) => [
          styles.card,
          { borderColor: colors.border, backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
        ]}>
        <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
          <Icon name={tpl.icon} size={18} color={colors.textMuted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>{tpl.title}</Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {metaParts.join(' · ')}
          </Txt>
        </View>
        {!tpl.builtin ? (
          confirming ? (
            <View style={styles.confirmRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tpl.title + ' 삭제 확인'}
                onPress={(e) => {
                  e.stopPropagation();
                  confirmDelete(tpl, index);
                }}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}>
                <Txt variant="caption" tone="danger" style={{ fontWeight: '700' }}>삭제</Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="삭제 취소"
                onPress={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(null);
                }}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
                ]}>
                <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>취소</Txt>
              </Pressable>
            </View>
          ) : (
            <IconButton
              name="trash-2"
              label={tpl.title + ' 삭제'}
              size={15}
              color={colors.textFaint}
              onPress={() => {
                haptic.tap();
                setConfirmDeleteId(tpl.id);
              }}
              style={{ width: 32, height: 32 }} />
          )
        ) : (
          <Icon name="chevron-right" size={18} color={colors.textFaint} />
        )}
      </Pressable>
    );
  };

  const canApply = applyMode === 'expand' ? selectedItems.length > 0 : !!(draftTitle.trim() || selected?.title);

  return (
    <Sheet visible={visible} onClose={onClose} title={selected ? undefined : '체크리스트 템플릿'}>
      {selected ? (
        <View style={{ gap: space.md }}>
          <View style={styles.previewHeader}>
            <IconButton
              name="arrow-left"
              label="템플릿 목록으로"
              size={18}
              color={colors.textMuted}
              onPress={() => setSelected(null)}
              style={{ width: 34, height: 34 }} />
            <Txt variant="heading" style={{ flex: 1 }} numberOfLines={1}>템플릿 적용</Txt>
            <Txt variant="caption" tone="muted" tabular>
              {selectedItems.length}/{selected.items.length} 선택
            </Txt>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xs }} keyboardShouldPersistTaps="handled">
            <Segmented value={applyMode} options={APPLY_MODES} onChange={setApplyMode} />

            {applyMode === 'checklist' ? (
              <View style={{ gap: 6 }}>
                <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>제목</Txt>
                <TextInput
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="체크리스트 제목"
                  placeholderTextColor={colors.textFaint}
                  maxLength={500}
                  accessibilityLabel="템플릿 제목"
                  style={[
                    type.bodyStrong,
                    styles.titleInput,
                    { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.text },
                  ]} />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>일정</Txt>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {DUE_CHOICES.map((choice) => (
                  <Chip
                    key={choice.value}
                    icon={choice.icon}
                    label={choice.label}
                    selected={dueChoice === choice.value}
                    onPress={() => setDueChoice(choice.value)} />
                ))}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>목록</Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip
                  icon="inbox"
                  label="미분류"
                  selected={targetProjectId === null}
                  onPress={() => setTargetProjectId(null)} />
                {(projects ?? []).map((proj) => (
                  <Chip
                    key={proj.id}
                    icon="hash"
                    label={proj.name}
                    selected={targetProjectId === proj.id}
                    onPress={() => setTargetProjectId(proj.id)} />
                ))}
              </ScrollView>
            </View>

            {selected.items.length > 0 ? (
              <View style={{ gap: 6 }}>
                <View style={styles.itemsHeader}>
                  <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>포함할 항목</Txt>
                  <Pressable hitSlop={8} onPress={toggleAllItems} accessibilityRole="button" accessibilityLabel={allChecked ? '전체 해제' : '전체 선택'}>
                    <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>
                      {allChecked ? '전체 해제' : '전체 선택'}
                    </Txt>
                  </Pressable>
                </View>
                <View style={[styles.itemList, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
                  {selected.items.map((item, idx) => {
                    const checked = checkedItems[idx] !== false;
                    return (
                      <Pressable
                        key={`${idx}-${item}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        accessibilityLabel={item}
                        onPress={() => toggleItem(idx)}
                        style={({ pressed }) => [
                          styles.checkRow,
                          idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                          { opacity: pressed ? 0.65 : 1 },
                        ]}>
                        <View
                          style={[
                            styles.miniBox,
                            {
                              borderColor: checked ? colors.accent : colors.control,
                              backgroundColor: checked ? colors.accent : 'transparent',
                            },
                          ]}>
                          {checked ? <Icon name="check" size={12} color={colors.onAccent} /> : null}
                        </View>
                        <Txt
                          variant="body"
                          tone={checked ? 'default' : 'faint'}
                          style={{ flex: 1, textDecorationLine: checked ? 'none' : 'line-through' }}>
                          {item}
                        </Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {(selected.defaultDurationMinutes || (selected.tags && selected.tags.length > 0)) ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {selected.defaultDurationMinutes ? (
                  <Chip icon="clock" label={formatDurationMinutes(selected.defaultDurationMinutes)} tone="set" />
                ) : null}
                {(selected.tags ?? []).map((tag) => (
                  <Chip key={tag} icon="tag" label={tag} tone="set" />
                ))}
              </View>
            ) : null}
          </ScrollView>

          <Button
            label={
              applyMode === 'expand'
                ? `항목 ${selectedItems.length}개 추가`
                : selectedItems.length > 0
                  ? `체크리스트 추가 (${selectedItems.length}개)`
                  : '할 일 추가'
            }
            disabled={!canApply}
            onPress={handleApply} />
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
          <Txt variant="small" tone="muted">
            자주 쓰는 체크리스트를 선택해 항목과 일정을 고른 뒤 한 번에 추가할 수 있습니다.
          </Txt>
          {custom.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Txt variant="section" tone="muted">내 템플릿</Txt>
              {custom.map((tpl, index) => renderItem(tpl, index))}
            </View>
          ) : null}
          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">추천 체크리스트</Txt>
            {builtin.map((tpl, index) => renderItem(tpl, index))}
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmBtn: {
    paddingHorizontal: 10, height: 28, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titleInput: {
    minHeight: 44, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md, paddingVertical: 10,
  },
  itemsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemList: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 11,
  },
  miniBox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
});
