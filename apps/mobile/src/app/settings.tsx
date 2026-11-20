import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { Button, Card, Header, IconButton, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useProfile, useSession } from '@/data/session';
import { UpdateCard } from '@/features/update/UpdateCard';
import { deviceTimeZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { space, type ThemeMode, useTheme } from '@/theme';

const examples: [string, string][] = [
  ['내일 저녁 7시 운동', '날짜와 시간'],
  ['매주 월수금 오전 8시 수영', '요일 반복'],
  ['평일마다 영단어 30개', '평일 반복'],
  ['11월 25일까지 보고서 #회사 p1', '마감일 · 프로젝트 · 우선순위'],
  ['장보기 @집 @주말', '태그'],
  ['every Mon 9am standup', '영어도 됩니다'],
];

export default function Settings() {
  const { mode, setMode } = useTheme();
  const { session, signOut } = useSession();
  const { data: profile } = useProfile();
  const [confirm, setConfirm] = useState(false);

  return (
    <Screen>
      <Header title="설정" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">앱 업데이트</Txt>
          <UpdateCard />
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">화면</Txt>
          <Segmented<ThemeMode>
            value={mode} onChange={setMode}
            options={[{ value: 'system', label: '시스템', icon: 'smartphone' }, { value: 'light', label: '라이트', icon: 'sun' }, { value: 'dark', label: '다크', icon: 'moon' }]} />
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">빠른 입력 예시</Txt>
          <Card style={{ gap: space.md }}>
            {examples.map(([text, label]) => (
              <View key={text} style={{ gap: 2 }}>
                <Txt>{text}</Txt>
                <Txt variant="small" tone="muted">{label}</Txt>
              </View>
            ))}
          </Card>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">계정</Txt>
          <Card style={{ paddingVertical: space.xs }}>
            <Row icon="mail" label="이메일" detail={session?.user.email ?? ''} />
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
