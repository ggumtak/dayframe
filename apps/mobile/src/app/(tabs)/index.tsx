import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Button, EmptyState, Header, IconButton, Loading, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { useFocusSessions } from '@/data/focus';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TaskList } from '@/features/tasks/TaskList';
import { Timeline } from '@/features/tasks/Timeline';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { UpdateBanner } from '@/features/update/UpdateBanner';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

export default function Today() {
  const { colors } = useTheme();
  const { tasks, isLoading, isError, refetch } = useTaskIndex();
  const { data: sessions } = useFocusSessions();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [refreshing, setRefreshing] = useState(false);
  useMinute();
  const timeZone = deviceTimeZone();
  const date = today(timeZone);
  useScreenDefaults({ dueToday: true });

  // Bucketed on every render: `useMinute` re-renders this screen when the date rolls over.
  const overdue = tasks.filter((task) => dueBucket(task) === 'overdue').sort(bySchedule);
  const due = tasks.filter((task) => dueBucket(task) === 'today').sort(bySchedule);

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const moveOverdue = () => {
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`지연된 ${overdue.length}개를 오늘로 옮겼습니다.`);
  };

  const addAt = (minutes: number) => {
    const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    quickAdd.open({ dueToday: true, initialText: '오늘 ' + clock + ' ' });
  };

  return (
    <Screen>
      <Header
        title="오늘" subtitle={`${date.month}월 ${date.day}일 ${weekdayName(date)}요일 · ${due.length ? due.length + '개 남음' : '남은 일 없음'}`}
        right={<IconButton name="settings" label="설정" onPress={() => router.push('/settings')} color={colors.textMuted} />} />
      <UpdateBanner />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Segmented
          value={view} onChange={setView}
          options={[{ value: 'list', label: '목록', icon: 'list' }, { value: 'timeline', label: '타임라인', icon: 'clock' }]} />
      </View>

      {isLoading ? <Loading /> : view === 'timeline' ? (
        <Timeline tasks={due} sessions={sessions ?? []} timeZone={timeZone} onComplete={flow.complete} onAddAt={addAt} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {isError && tasks.length === 0 ? (
            <EmptyState
              icon="cloud-off" title="불러오지 못했습니다" message="네트워크 연결을 확인한 뒤 다시 시도해 주세요."
              action={<Button label="다시 시도" kind="secondary" onPress={refresh} />} />
          ) : overdue.length + due.length === 0 ? (
            <EmptyState icon="sun" title="오늘 할 일을 모두 마쳤습니다" message="아래 + 버튼으로 새 할 일을 추가해 보세요." />
          ) : (
            <>
              {overdue.length ? (
                <>
                  <SectionTitle
                    title="지연됨" count={overdue.length}
                    action={(
                      <Button
                        label="오늘로 옮기기" kind="ghost" icon="corner-down-right" onPress={moveOverdue}
                        style={{ minHeight: 30, paddingHorizontal: space.sm }} />
                    )} />
                  <TaskList tasks={overdue} />
                </>
              ) : null}
              {due.length ? (
                <>
                  <SectionTitle title="오늘" count={due.length} />
                  <TaskList tasks={due} hideDate />
                </>
              ) : overdue.length ? (
                <Txt variant="small" tone="muted" style={{ padding: space.lg }}>오늘 예정된 일은 없습니다.</Txt>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
