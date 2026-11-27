import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Button, EmptyState, Icon, type IconName, Loading, Txt } from '@/components/ui';
import { useFocusSessions } from '@/data/focus';
import { useHabitDetails, useHabits } from '@/data/habits';
import { nextPosition, useProjects, useTasks } from '@/data/tasks';
import { runAi } from '@/features/ai/client';
import { AiErrorView, AiLoading, AiScreen, KeyGate, UsageLine } from '@/features/ai/components';
import { type CachedReview, readCachedReview, saveCachedReview } from '@/features/ai/prefs';
import { REVIEW_SYSTEM, reviewUser } from '@/features/ai/prompts';
import { gatherWeek, reviewRange } from '@/features/ai/review';
import { parseReview, reviewSchema, type WeeklyReview } from '@/features/ai/schemas';
import { formatKoreanDate, nowContext } from '@/features/ai/time';
import { useAiRequest } from '@/features/ai/useAiRequest';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { api } from '@/lib/api';
import { deviceTimeZone, formatMinutes, Temporal, today } from '@/lib/dates';
import type { TaskCompletion } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

/** One part of the review: a neutral heading (the words say good or missed, not a colour), then plain bullets. */
function List({ icon, title, items }: { icon: IconName; title: string; items: string[] }) {
  const { colors } = useTheme();
  if (!items.length) return null;
  return (
    <View style={[styles.section, { borderTopColor: colors.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={icon} size={16} color={colors.textMuted} />
        <Txt variant="section" accessibilityRole="header">{title}</Txt>
      </View>
      {items.map((item, idx) => (
        <View key={`${item}-${idx}`} style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={[styles.bullet, { backgroundColor: colors.textFaint }]} />
          <Txt variant="body" style={{ flex: 1 }}>{item}</Txt>
        </View>
      ))}
    </View>
  );
}

const dateLabel = (iso: string) => formatKoreanDate(Temporal.PlainDate.from(iso));

/** 주간 돌아보기: the last seven days read back as a short card; the last one is kept so reopening costs nothing. */
export default function Review() {
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const range = reviewRange(today(zone));
  const flow = useTaskFlow();
  const request = useAiRequest<WeeklyReview>();
  const [cached, setCached] = useState<CachedReview | null | undefined>(undefined);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const from = Temporal.PlainDate.from(range.from).toZonedDateTime(zone).toInstant().toString();
  const completions = useQuery({
    queryKey: ['ai-review', 'completions', range.from], queryFn: () => api.completionsSince(from), meta: { persist: false },
  });
  const { data: openTasks } = useTasks();
  const { data: habits } = useHabits();
  const habitList = useMemo(() => habits ?? [], [habits]);
  const details = useHabitDetails(habitList);
  const { data: focusSessions } = useFocusSessions();
  const { data: projects } = useProjects();

  useEffect(() => {
    let active = true;
    void readCachedReview().then((value) => {
      if (!active) return;
      // Stored data is checked like a fresh reply: an older or damaged entry is dropped, not shown.
      const review = value ? parseReview({
        ...value.review, suggestions: Array.isArray(value.review.suggestions)
          ? value.review.suggestions.map((item) => ({ title: item?.title, as_task: item?.asTask })) : [],
      }) : null;
      setCached(value && review ? { ...value, review } : null);
    });
    return () => { active = false; };
  }, []);

  const buildFacts = (completionRows: TaskCompletion[]) => gatherWeek({
    range, timeZone: zone, completions: completionRows, openTasks: openTasks ?? [], habits: habitList,
    habitLogs: new Map([...details].map(([id, detail]) => [id, detail.logs])), focusSessions: focusSessions ?? [],
    listNames: new Map((projects ?? []).map((project) => [project.id, project.name])),
  });

  const facts = useMemo(() => gatherWeek({
    range, timeZone: zone, completions: completions.data ?? [], openTasks: openTasks ?? [], habits: habitList,
    habitLogs: new Map([...details].map(([id, detail]) => [id, detail.logs])), focusSessions: focusSessions ?? [],
    listNames: new Map((projects ?? []).map((project) => [project.id, project.name])),
    // range is recomputed each render from today's date; its strings are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [range.from, range.to, zone, completions.data, openTasks, habitList, details, focusSessions, projects]);

  const make = async () => {
    let completionRows = completions.data;
    if (!completions.isSuccess || completionRows === undefined) {
      const refetched = await completions.refetch();
      if (refetched.isError || !refetched.data) {
        showToast('완료 기록을 불러오지 못했습니다. 연결을 확인해 주세요.', { tone: 'error' });
        return;
      }
      completionRows = refetched.data;
    }
    const freshFacts = buildFacts(completionRows);
    const result = await request.run((signal) => runAi({
      feature: 'review', system: REVIEW_SYSTEM, user: reviewUser(nowContext(Temporal.Now.instant(), zone), freshFacts),
      schema: reviewSchema(), effort: 'medium', signal,
    }));
    if (!result) return;
    const entry: CachedReview = { range, createdAt: new Date().toISOString(), model: result.model, usage: result.usage, review: result.data };
    saveCachedReview(entry);
    setCached(entry);
    setAdded(new Set());
  };

  const addTask = (key: string, title: string) => {
    const inbox = (openTasks ?? []).filter((task) => !task.parent_task_id && !task.project_id);
    flow.create({ input: { title, priority: 4, timezone: zone, position: nextPosition(inbox) } });
    setAdded((current) => new Set(current).add(key));
    showToast('할 일로 추가했습니다.');
  };

  const { state } = request;
  const focusTotal = facts.focus.reduce((sum, day) => sum + day.minutes, 0);
  const shown = state.status === 'idle' || state.status === 'done' ? cached : null;
  const stale = shown && (shown.range.to !== range.to);
  const completionsUnavailable = !completions.isSuccess && !completions.isLoading;

  let body;
  if (cached === undefined) body = <Loading />;
  else if (state.status === 'loading') body = <AiLoading message="지난 7일의 기록을 정리하고 있습니다" onCancel={request.cancel} />;
  else if (state.status === 'error') body = <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void make()} />;
  else if (shown) {
    const { review } = shown;
    body = (
      <>
        <Txt variant="small" tone="muted">
          {dateLabel(shown.range.from)} ~ {dateLabel(shown.range.to)}{stale ? ' · 이전 기간 기준' : ''}
        </Txt>
        <Txt variant="heading" style={styles.headline}>{review.headline}</Txt>
        <List icon="award" title="잘한 점" items={review.wins} />
        <List icon="alert-triangle" title="아쉬운 점" items={review.slipped} />
        <List icon="trending-up" title="눈에 띄는 흐름" items={review.patterns} />
        {review.suggestions.length ? (
          <View style={[styles.section, { borderTopColor: colors.border, gap: space.md }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="compass" size={16} color={colors.textMuted} />
              <Txt variant="section" accessibilityRole="header">다음 주 제안</Txt>
            </View>
            {review.suggestions.map((item, idx) => {
              const suggestionKey = `${item.title}-${idx}`;
              const isAdded = added.has(suggestionKey);
              return (
                <View key={suggestionKey} style={{ gap: space.sm }}>
                  <Txt variant="body">{item.title}</Txt>
                  {item.asTask ? (
                    <Button
                      label={isAdded ? '추가됨' : '할 일로 추가'} icon={isAdded ? 'check' : 'plus'}
                      kind="secondary" disabled={isAdded} onPress={() => addTask(suggestionKey, item.title)}
                      style={{ alignSelf: 'flex-start', minHeight: 36 }} />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <UsageLine result={shown} />
      </>
    );
  } else if (completions.isLoading) {
    body = <Loading />;
  } else if (completionsUnavailable) {
    body = (
      <EmptyState
        icon="wifi-off"
        title="완료 기록을 불러오지 못했습니다"
        message="지난 7일의 완료 기록을 가져와야 주간 돌아보기를 만들 수 있습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        action={<Button label="다시 시도" icon="refresh-cw" onPress={() => void completions.refetch()} />} />
    );
  } else {
    body = (
      <>
        <Txt variant="small" tone="muted">
          {dateLabel(range.from)} ~ {dateLabel(range.to)} 기록을 바탕으로 한 주를 정리해 드립니다. 만든 돌아보기는 저장되므로 다시 열어도 요금이 들지 않습니다.
        </Txt>
        <View style={styles.stats}>
          <Stat label="완료" value={`${facts.completed.length}개`} />
          <Stat label="집중" value={formatMinutes(focusTotal * 60)} />
          <Stat label="지연" value={`${facts.overdue.length}개`} />
          <Stat label="습관" value={`${facts.habits.length}개`} />
        </View>
      </>
    );
  }

  const canMake = shown ? true : completions.isSuccess;
  const footer = state.status === 'loading' || state.status === 'error' || cached === undefined || !canMake ? undefined : (
    <Button
      label={shown ? '다시 만들기' : '돌아보기 만들기'} icon={shown ? 'refresh-cw' : undefined}
      leading={shown ? undefined : <AiIcon size={16} color={colors.onAccent} />} kind={shown && !stale ? 'secondary' : 'primary'}
      onPress={() => void make()} />
  );

  return (
    <AiScreen title="주간 돌아보기" footer={footer}>
      <KeyGate>{body}</KeyGate>
    </AiScreen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}>
      <Txt variant="caption" tone="muted">{label}</Txt>
      <Txt variant="bodyStrong">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { paddingVertical: space.sm },
  section: { gap: space.sm, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, flexBasis: '45%', padding: space.md, borderRadius: radius.md, gap: 2 },
});
