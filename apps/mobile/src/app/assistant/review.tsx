import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Icon, type IconName, Loading, Txt } from '@/components/ui';
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
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

function List({ icon, title, items, tone }: { icon: IconName; title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={icon} size={16} color={tone} />
        <Txt variant="section" accessibilityRole="header">{title}</Txt>
      </View>
      {items.map((item) => (
        <View key={item} style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={[styles.bullet, { backgroundColor: tone }]} />
          <Txt variant="body" style={{ flex: 1 }}>{item}</Txt>
        </View>
      ))}
    </Card>
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

  const facts = useMemo(() => gatherWeek({
    range, timeZone: zone, completions: completions.data ?? [], openTasks: openTasks ?? [], habits: habitList,
    habitLogs: new Map([...details].map(([id, detail]) => [id, detail.logs])), focusSessions: focusSessions ?? [],
    listNames: new Map((projects ?? []).map((project) => [project.id, project.name])),
    // range is recomputed each render from today's date; its strings are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [range.from, range.to, zone, completions.data, openTasks, habitList, details, focusSessions, projects]);

  const make = async () => {
    const result = await request.run((signal) => runAi({
      feature: 'review', system: REVIEW_SYSTEM, user: reviewUser(nowContext(Temporal.Now.instant(), zone), facts),
      schema: reviewSchema(), effort: 'medium', signal,
    }));
    if (!result) return;
    const entry: CachedReview = { range, createdAt: new Date().toISOString(), model: result.model, usage: result.usage, review: result.data };
    saveCachedReview(entry);
    setCached(entry);
    setAdded(new Set());
  };

  const addTask = (title: string) => {
    const inbox = (openTasks ?? []).filter((task) => !task.parent_task_id && !task.project_id);
    flow.create({ input: { title, priority: 4, timezone: zone, position: nextPosition(inbox) } });
    setAdded((current) => new Set(current).add(title));
    showToast('할 일에 추가했습니다.');
  };

  const { state } = request;
  const ready = !completions.isPending;
  const focusTotal = facts.focus.reduce((sum, day) => sum + day.minutes, 0);
  const shown = state.status === 'idle' || state.status === 'done' ? cached : null;
  const stale = shown && (shown.range.to !== range.to);

  let body;
  if (cached === undefined || !ready) body = <Loading />;
  else if (state.status === 'loading') body = <AiLoading message="지난 7일을 돌아보고 있습니다" onCancel={request.cancel} />;
  else if (state.status === 'error') body = <AiErrorView kind={state.kind} detail={state.detail} onRetry={() => void make()} />;
  else if (shown) {
    const { review } = shown;
    body = (
      <>
        <Txt variant="small" tone="muted">
          {dateLabel(shown.range.from)} ~ {dateLabel(shown.range.to)}{stale ? ' · 지난 돌아보기입니다' : ''}
        </Txt>
        <View style={[styles.headline, { backgroundColor: colors.accentSoft }]}>
          <Txt variant="heading">{review.headline}</Txt>
        </View>
        <List icon="award" title="잘한 점" items={review.wins} tone={colors.success} />
        <List icon="alert-triangle" title="놓친 점" items={review.slipped} tone={colors.warning} />
        <List icon="trending-up" title="보이는 흐름" items={review.patterns} tone={colors.accent} />
        {review.suggestions.length ? (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Icon name="compass" size={16} color={colors.accent} />
              <Txt variant="section" accessibilityRole="header">다음 주 제안</Txt>
            </View>
            {review.suggestions.map((item) => (
              <View key={item.title} style={{ gap: space.sm }}>
                <Txt variant="body">{item.title}</Txt>
                {item.asTask ? (
                  <Button
                    label={added.has(item.title) ? '추가했습니다' : '할 일로 추가'} icon={added.has(item.title) ? 'check' : 'plus'}
                    kind="secondary" disabled={added.has(item.title)} onPress={() => addTask(item.title)}
                    style={{ alignSelf: 'flex-start', minHeight: 36 }} />
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}
        <UsageLine result={shown} />
      </>
    );
  } else {
    body = (
      <>
        <Txt variant="small" tone="muted">
          {dateLabel(range.from)} ~ {dateLabel(range.to)}의 기록으로 한 주를 돌아봅니다. 한 번 만든 돌아보기는 저장해 두고 다시 열어도 요금이 들지 않습니다.
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

  const footer = state.status === 'loading' || state.status === 'error' || cached === undefined || !ready ? undefined : (
    <Button
      label={shown ? '다시 만들기' : '돌아보기 만들기'} icon={shown ? 'refresh-cw' : 'zap'} kind={shown && !stale ? 'secondary' : 'primary'}
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
  headline: { padding: space.lg, borderRadius: radius.lg },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, flexBasis: '45%', padding: space.md, borderRadius: radius.md, gap: 2 },
});
