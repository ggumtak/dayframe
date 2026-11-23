import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { Button, Card, Header, Icon, IconButton, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useNewTaskDate, useProfile, useSession } from '@/data/session';
import { RemindersCard } from '@/features/reminders/RemindersCard';
import { UpdateCard } from '@/features/update/UpdateCard';
import { deviceTimeZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { haptic, setHapticsEnabled, useHapticsEnabled } from '@/lib/haptics';
import type { NewTaskDate } from '@/lib/shared';
import { space, type ThemeMode, useTheme } from '@/theme';

export default function Settings() {
  const { colors, mode, setMode } = useTheme();
  const { account, signOut } = useSession();
  const { data: profile } = useProfile();
  const [confirm, setConfirm] = useState(false);
  const [newTaskDate, setNewTaskDate] = useNewTaskDate();
  const hapticsOn = useHapticsEnabled();

  return (
    <Screen>
      <Header title="설정" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">앱 업데이트</Txt>
          <UpdateCard />
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">날짜 없이 적은 할 일</Txt>
          <Segmented<NewTaskDate>
            value={newTaskDate} onChange={setNewTaskDate}
            options={[{ value: 'today', label: '오늘에 넣기', icon: 'sun' }, { value: 'none', label: '목록에만', icon: 'list' }]} />
          <Txt variant="small" tone="muted">
            {newTaskDate === 'today'
              ? '날짜를 적지 않은 할 일도 오늘 탭에 바로 보입니다. AI로 추가한 할 일도 같습니다. 추가 창의 ‘오늘 ×’를 누르면 그 할 일만 날짜 없이 넣습니다.'
              : '날짜를 적지 않은 할 일은 목록 탭에만 들어갑니다. 오늘 탭에서 추가할 때는 오늘 날짜가 붙습니다.'}
          </Txt>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">알림</Txt>
          <RemindersCard />
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">AI 비서</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row
              icon="cpu" label="AI 연결" detail="Claude · ChatGPT"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={() => router.push('/ai')} />
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">화면 · 피드백</Txt>
          <Segmented<ThemeMode>
            value={mode} onChange={setMode}
            options={[{ value: 'system', label: '시스템', icon: 'smartphone' }, { value: 'light', label: '라이트', icon: 'sun' }, { value: 'dark', label: '다크', icon: 'moon' }]} />
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

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">기록 · 루틴</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row
              icon="check-circle" label="완료한 일" detail="전체 완료 기록"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={() => router.push('/completed')} />
            <Row
              icon="star" label="추천 루틴" detail="눌러서 습관에 추가"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={() => router.push('/routines')} />
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">계정</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row icon="mail" label="이메일" detail={account?.email ?? ''} />
            <Row icon="globe" label="시간대" detail={profile?.timezone ?? deviceTimeZone()} />
            <Row icon="github" label="소스와 릴리스" detail={env.githubRepo} onPress={() => void Linking.openURL('https://github.com/' + env.githubRepo + '/releases')} />
            <Row icon="log-out" label="로그아웃" tone="danger" onPress={() => setConfirm(true)} />
          </Card>
        </View>
      </ScrollView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="로그아웃할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          이 기기에 저장된 데이터가 지워집니다. 아직 서버에 보내지 못한 오프라인 변경 사항이 있다면 함께 사라집니다.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button
            label="로그아웃" kind="danger"
            onPress={() => {
              setConfirm(false);
              void signOut();
            }} />
          <Button label="취소" kind="secondary" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
