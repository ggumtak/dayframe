import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';

import { Button, Card, Header, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { MAX_CONNECTIONS, useConnections, useCreateConnection, useRemoveConnection } from '@/data/connections';
import { deviceTimeZone, formatTime, Temporal } from '@/lib/dates';
import type { McpConnection, NewMcpConnection } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

const assistants = ['Claude', 'ChatGPT', '다른 AI'];

const guides: { name: string; steps: string[] }[] = [
  {
    name: 'Claude',
    steps: [
      'claude.ai → 설정 → 커넥터',
      '커스텀 커넥터 추가 · 이름 Dayframe · 주소 붙여넣기 · 로그인 없음',
      '“오늘 할 일 보여줘”로 연결 확인',
    ],
  },
  {
    name: 'ChatGPT',
    steps: [
      'chatgpt.com → 설정 → 앱 및 커넥터 → 개발자 모드 켜기',
      '만들기 · 이름 Dayframe · MCP URL 붙여넣기 · 인증 없음',
      'Dayframe 선택 후 “오늘 할 일 보여줘”로 확인',
    ],
  },
];

function formatMoment(iso: string): string {
  const moment = Temporal.Instant.from(iso).toZonedDateTimeISO(deviceTimeZone());
  return moment.month + '월 ' + moment.day + '일 ' + formatTime(moment.hour * 60 + moment.minute);
}

// The address is long and one wrong character makes the AI look for a sign-in page, so it is only ever
// copied or shared, never retyped.
async function copyAddress(url: string) {
  try {
    await Clipboard.setStringAsync(url);
    showToast('연결 주소를 복사했습니다.');
  } catch {
    showToast('복사에 실패했습니다. 주소를 길게 눌러 직접 복사해 주세요.', { tone: 'error' });
  }
}

async function shareAddress(url: string) {
  try {
    await Share.share({ message: url });
  } catch {
    showToast('공유 창을 열지 못했습니다. 주소를 길게 눌러 직접 복사해 주세요.', { tone: 'error' });
  }
}

export default function AiConnections() {
  const { colors } = useTheme();
  const { data: connections, isPending, isError, refetch } = useConnections();
  const create = useCreateConnection();
  const remove = useRemoveConnection();
  const [choosing, setChoosing] = useState(false);
  const [fresh, setFresh] = useState<NewMcpConnection | null>(null);
  const [removing, setRemoving] = useState<McpConnection | null>(null);
  const full = (connections?.length ?? 0) >= MAX_CONNECTIONS;

  return (
    <Screen>
      <Header title="AI 연결" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <Txt variant="small" tone="muted">Claude·ChatGPT에서 할 일과 습관을 관리합니다.</Txt>

        {fresh ? (
          <Card style={{ gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Txt variant="bodyStrong">{fresh.label} 연결 주소</Txt>
              <Txt variant="small" tone="muted">지금 한 번만 표시됩니다. 외부에 공유하지 마세요.</Txt>
            </View>
            <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: space.md }}>
              <Txt variant="small" selectable accessibilityLabel="연결 주소">{fresh.url}</Txt>
            </View>
            <Button label="연결 주소 복사" icon="copy" onPress={() => void copyAddress(fresh.url)} />
            {Platform.OS !== 'web' ? (
              <Button label="컴퓨터로 공유하기" kind="secondary" icon="share-2" onPress={() => void shareAddress(fresh.url)} />
            ) : null}
            <Button label="등록 완료" kind="secondary" onPress={() => setFresh(null)} />
          </Card>
        ) : (
          <View style={{ gap: space.sm }}>
            <Button
              label="새 연결 주소 만들기" icon="plus" loading={create.isPending} disabled={full || isPending}
              onPress={() => setChoosing(true)} />
            {full ? <Txt variant="small" tone="muted">최대 {MAX_CONNECTIONS}개까지 연결할 수 있습니다.</Txt> : null}
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">연결된 AI</Txt>
          {isPending ? <Loading /> : isError && !connections ? (
            <Card style={{ gap: space.md }}>
              <Txt tone="muted">연결 목록을 불러오지 못했습니다.</Txt>
              <Button label="다시 시도" kind="secondary" onPress={() => void refetch()} />
            </Card>
          ) : connections?.length ? (
            <Card style={{ gap: space.md }}>
              {connections.map((connection) => (
                <View key={connection.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{connection.label}</Txt>
                    <Txt variant="small" tone="muted">
                      {connection.last_used_at ? '마지막 사용 ' + formatMoment(connection.last_used_at) : '사용 기록 없음'}
                      {' · 등록 ' + formatMoment(connection.created_at)}
                    </Txt>
                  </View>
                  <Button label="해제" kind="danger" style={{ minHeight: 36, paddingHorizontal: space.md }} onPress={() => setRemoving(connection)} />
                </View>
              ))}
            </Card>
          ) : (
            <Card><Txt tone="muted">아직 연결된 AI가 없습니다.</Txt></Card>
          )}
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">등록 방법</Txt>
          {guides.map((guide) => (
            <Card key={guide.name} style={{ gap: space.sm }}>
              <Txt variant="bodyStrong">{guide.name}</Txt>
              {guide.steps.map((step, index) => (
                <View key={step} style={{ flexDirection: 'row', gap: space.sm }}>
                  <Txt variant="small" tone="faint">{index + 1}</Txt>
                  <Txt variant="small" tone="muted" style={{ flex: 1 }}>{step}</Txt>
                </View>
              ))}
            </Card>
          ))}
        </View>
      </ScrollView>

      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="어느 AI에 연결할까요?">
        {assistants.map((label) => (
          <Row
            key={label} icon="link" label={label}
            onPress={() => {
              setChoosing(false);
              create.mutate(label, { onSuccess: setFresh });
            }} />
        ))}
      </Sheet>

      <Sheet visible={!!removing} onClose={() => setRemoving(null)} title={(removing?.label ?? '') + ' 연결을 해제할까요?'}>
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          연결을 해제하면 이 주소는 사용할 수 없습니다.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Button
            label="해제" kind="danger"
            onPress={() => {
              if (removing) remove.mutate(removing.id);
              if (removing && fresh?.id === removing.id) setFresh(null);
              setRemoving(null);
            }} />
          <Button label="취소" kind="secondary" onPress={() => setRemoving(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}
