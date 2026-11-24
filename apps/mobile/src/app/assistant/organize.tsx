import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, Icon, Sheet, Txt } from '@/components/ui';
import { nextPosition, useProjects, useTasks } from '@/data/tasks';
import { runAi } from '@/features/ai/client';
import { AiErrorView, AiLoading, AiScreen, KeyGate, Toggle, UsageLine } from '@/features/ai/components';
import { ORGANIZE_SYSTEM, organizeUser } from '@/features/ai/prompts';
import { type OrganizedTask, organizeSchema } from '@/features/ai/schemas';
import { nowContext, parseIsoDate } from '@/features/ai/time';
import { useAiRequest } from '@/features/ai/useAiRequest';
import { PRIORITY_LABEL } from '@/features/ai/labels';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { parseTimeInput, timeInputText } from '@/features/tasks/timeInput';
import { deviceTimeZone, formatDate, formatDurationMinutes, formatTime, instantFor, Temporal, today } from '@/lib/dates';
import { showToast } from '@/lib/toast';
import { fontFamily, priorityColor, radius, space, useTheme } from '@/theme';

interface Draft extends OrganizedTask {
  key: number;
  include: boolean;
}

function when(draft: Pick<Draft, 'date' | 'minutes'>, now: Temporal.PlainDate): string | null {
  const date = parseIsoDate(draft.date);
  if (!date) return null;
  return formatDate(date, now) + (draft.minutes !== null ? ' ' + formatTime(draft.minutes) : '');
}

function DraftRow({ draft, now, onToggle, onEdit }: { draft: Draft; now: Temporal.PlainDate; onToggle: () => void; onEdit: () => void }) {
  const { colors } = useTheme();
  const date = when(draft, now);
  const meta = [date, draft.list ?? '미분류', draft.durationMinutes ? formatDurationMinutes(draft.durationMinutes) : null].filter(Boolean);
  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface, opacity: draft.include ? 1 : 0.55 }]}>
      <Toggle on={draft.include} onPress={onToggle} label={`${draft.title} 추가`} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${draft.title} 고치기`} onPress={onEdit} style={{ flex: 1, gap: 4 }}>
        <Txt variant="bodyStrong">{draft.title}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.sm, rowGap: 2 }}>
          {draft.priority < 4 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="flag" size={12} color={priorityColor(colors, draft.priority)} />
              <Txt variant="caption" style={{ color: priorityColor(colors, draft.priority) }}>{PRIORITY_LABEL[draft.priority]}</Txt>
            </View>
          ) : null}
          <Txt variant="caption" tone="muted">{meta.join(' · ')}</Txt>
        </View>
        {draft.subtasks.map((sub) => (
          <View key={sub} style={styles.sub}>
            <View style={[styles.subDot, { borderColor: colors.textFaint }]} />
            <Txt variant="small" tone="muted" style={{ flex: 1 }}>{sub}</Txt>
          </View>
        ))}
      </Pressable>
      <Icon name="edit-2" size={14} color={colors.textFaint} />
    </View>
  );
}

function EditSheet({ draft, lists, now, onClose, onSave }: {
  draft: Draft | null; lists: string[]; now: Temporal.PlainDate; onClose: () => void; onSave: (draft: Draft) => void;
}) {
  const { colors } = useTheme();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [list, setList] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  if (draft && opened !== draft.key) {
    setOpened(draft.key);
    setTitle(draft.title);
    setDate(draft.date);
    setTime(draft.minutes !== null ? timeInputText(draft.minutes) : '');
    setList(draft.list);
  }
  const minutes = time.trim() ? parseTimeInput(time) : null;
  const timeBad = !!time.trim() && minutes === null;
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => now.add({ days: offset }));
  const custom = date && !days.some((day) => day.toString() === date) ? parseIsoDate(date) : null;

  const save = () => {
    if (!draft || !title.trim() || timeBad) return;
    onSave({ ...draft, title: title.trim(), date: minutes !== null && !date ? now.toString() : date, minutes, list });
    onClose();
  };

  return (
    <Sheet visible={!!draft} onClose={onClose} title="할 일 고치기">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
        <TextInput
          value={title} onChangeText={setTitle} accessibilityLabel="제목" placeholder="제목" placeholderTextColor={colors.textFaint}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text, fontFamily }]} />
        <Txt variant="smallStrong" tone="muted">날짜</Txt>
        <View style={styles.chips}>
          <Chip label="날짜 없음" selected={!date} onPress={() => { setDate(null); setTime(''); }} />
          {custom ? <Chip label={formatDate(custom, now)} selected onPress={() => {}} /> : null}
          {days.map((day) => (
            <Chip key={day.toString()} label={formatDate(day, now)} selected={date === day.toString()} onPress={() => setDate(day.toString())} />
          ))}
        </View>
        <Txt variant="smallStrong" tone="muted">시간</Txt>
        <TextInput
          value={time} onChangeText={setTime} accessibilityLabel="시간" placeholder="예: 19:00, 오후 7시 (비우면 시간 없음)"
          placeholderTextColor={colors.textFaint} keyboardType="numbers-and-punctuation"
          style={[styles.input, { backgroundColor: colors.surfaceMuted, color: colors.text, fontFamily, borderColor: timeBad ? colors.danger : 'transparent' }]} />
        {timeBad ? <Txt variant="small" tone="danger">시간을 읽지 못했습니다. 19:00처럼 적어 주세요.</Txt> : null}
        <Txt variant="smallStrong" tone="muted">목록</Txt>
        <View style={styles.chips}>
          <Chip label="미분류" selected={!list} onPress={() => setList(null)} />
          {lists.map((name) => <Chip key={name} label={name} selected={list === name} onPress={() => setList(name)} />)}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button label="취소" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button label="저장" onPress={save} disabled={!title.trim() || timeBad} style={{ flex: 2 }} />
      </View>
    </Sheet>
  );
}

/** 메모 정리: free text in, a preview of tasks out; nothing is created until "N개 추가". */
export default function Organize() {
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const now = today(zone);
  const { data: projects } = useProjects();
  const { data: openTasks } = useTasks();
  const flow = useTaskFlow();
  const request = useAiRequest<OrganizedTask[]>();
  // Quick add's "AI로 정리" brings along whatever was typed there.
  const { text: carried } = useLocalSearchParams<{ text?: string }>();
  const [memo, setMemo] = useState(typeof carried === 'string' ? carried : '');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  const listNames = useMemo(() => (projects ?? []).slice().sort((a, b) => a.position - b.position).map((project) => project.name), [projects]);
  const chosen = drafts?.filter((draft) => draft.include) ?? [];

  const organize = async () => {
    const text = memo.trim();
    if (!text) return;
    const result = await request.run((signal) => runAi({
      feature: 'organize', system: ORGANIZE_SYSTEM,
      user: organizeUser(text, nowContext(Temporal.Now.instant(), zone), listNames),
      schema: organizeSchema(listNames, now), effort: 'low', signal,
    }));
    if (result) setDrafts(result.data.map((task, index) => ({ ...task, key: index, include: true })));
  };

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text.trim()) setMemo((current) => (current.trim() ? current.trimEnd() + '\n' + text : text));
      else showToast('복사한 내용이 없습니다.');
    } catch {
      showToast('붙여넣기를 하지 못했습니다.', { tone: 'error' });
    }
  };

  const add = () => {
    if (!chosen.length) return;
    const byName = new Map((projects ?? []).map((project) => [project.name, project.id]));
    const placed = new Map<string, number>();
    for (const draft of chosen) {
      const projectId = draft.list ? byName.get(draft.list) ?? null : null;
      const slot = projectId ?? '';
      const base = placed.get(slot)
        ?? nextPosition((openTasks ?? []).filter((task) => !task.parent_task_id && (task.project_id ?? '') === slot));
      placed.set(slot, base + 1024);
      const date = parseIsoDate(draft.date);
      const parentId = flow.create({
        input: {
          title: draft.title, priority: draft.priority, timezone: zone, position: base,
          ...(projectId ? { project_id: projectId } : {}),
          ...(date ? { due_at: instantFor(date, draft.minutes, zone), all_day: draft.minutes === null } : {}),
          ...(draft.durationMinutes ? { duration_minutes: draft.durationMinutes } : {}),
        },
      });
      draft.subtasks.forEach((title, index) => {
        flow.create({ input: { title, priority: 4, timezone: zone, position: (index + 1) * 1024, parent_task_id: parentId } });
      });
    }
    showToast(`할 일 ${chosen.length}개를 추가했습니다.`);
    router.back();
  };

  const { state } = request;
  const preview = state.status === 'done' && drafts;

  const footer = state.status === 'loading' || state.status === 'error' ? undefined : preview ? (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button label="다시 쓰기" kind="secondary" onPress={() => { setDrafts(null); request.reset(); }} style={{ flex: 1 }} />
      <Button label={chosen.length ? `${chosen.length}개 추가` : '고른 할 일 없음'} icon="plus" disabled={!chosen.length} onPress={add} style={{ flex: 2 }} />
    </View>
  ) : (
    <Button label="정리하기" icon="zap" disabled={!memo.trim()} onPress={() => void organize()} />
  );

  return (
    <AiScreen title="메모 정리" footer={footer}>
      <KeyGate>
        {state.status === 'loading' ? (
          <AiLoading message="메모를 할 일로 정리하고 있습니다" onCancel={request.cancel} />
        ) : state.status === 'error' ? (
          <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void organize()} />
        ) : preview ? (
          <>
            <Txt variant="small" tone="muted">
              {drafts.length ? '추가할 할 일만 남겨 두세요. 누르면 제목·날짜·시간·목록을 고칠 수 있습니다.' : '메모에서 할 일을 찾지 못했습니다. 메모를 조금 더 구체적으로 적어 보세요.'}
            </Txt>
            {drafts.map((draft) => (
              <DraftRow
                key={draft.key} draft={draft} now={now} onEdit={() => setEditing(draft)}
                onToggle={() => setDrafts((list) => list?.map((item) => (item.key === draft.key ? { ...item, include: !item.include } : item)) ?? null)} />
            ))}
            <UsageLine result={state.result} />
          </>
        ) : (
          <>
            <View style={[styles.memo, { backgroundColor: colors.surfaceMuted }]}>
              <TextInput
                value={memo} onChangeText={setMemo} multiline textAlignVertical="top" accessibilityLabel="메모"
                placeholder={'머릿속에 있는 것을 그대로 적어 보세요\n\n예: 내일 오전에 치과 전화, 금요일까지 보고서 초안. 주말엔 장보기(우유, 계란)'}
                placeholderTextColor={colors.textFaint} style={[styles.memoInput, { color: colors.text, fontFamily }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="붙여넣기" onPress={() => void paste()} hitSlop={6} style={styles.paste}>
                <Icon name="clipboard" size={16} color={colors.accent} />
                <Txt variant="smallStrong" tone="accent">붙여넣기</Txt>
              </Pressable>
              {memo ? (
                <Pressable accessibilityRole="button" accessibilityLabel="지우기" onPress={() => setMemo('')} hitSlop={6} style={styles.paste}>
                  <Txt variant="smallStrong" tone="muted">지우기</Txt>
                </Pressable>
              ) : null}
            </View>
            <Txt variant="caption" tone="faint">
              날짜·시간·목록은 메모에서 읽어 채웁니다. 추가하기 전에 하나씩 고칠 수 있습니다.
            </Txt>
          </>
        )}
      </KeyGate>
      <EditSheet
        draft={editing} lists={listNames} now={now} onClose={() => setEditing(null)}
        onSave={(next) => setDrafts((list) => list?.map((item) => (item.key === next.key ? next : item)) ?? null)} />
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  subDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 46, fontSize: 16, borderWidth: 1, borderColor: 'transparent' },
  memo: { borderRadius: radius.lg, padding: space.md, minHeight: 260 },
  memoInput: { flex: 1, fontSize: 16, lineHeight: 24, minHeight: 236 },
  paste: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40 },
});
