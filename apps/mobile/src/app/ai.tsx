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
      '컴퓨터에서 claude.ai를 열고 설정 → 커넥터로 이동합니다.',
      '"커스텀 커넥터 추가"를 누르고 이름에 Dayframe, 주소에 연결 주소를 붙여 넣습니다.',
      '대화창에서 "오늘 할 일 보여줘"라고 말해 확인합니다. 한 번 등록하면 휴대폰 Claude 앱에서도 쓸 수 있습니다.',
    ],
  },
  {
    name: 'ChatGPT',
    steps: [
      '컴퓨터에서 chatgpt.com을 열고 설정 → 앱 및 커넥터 → 고급 설정에서 개발자 모드를 켭니다.',
      '"만들기"를 누르고 이름에 Dayframe, MCP 서버 URL에 연결 주소를 넣고, 인증은 "인증 없음"을 고릅니다.',
      '대화창에서 Dayframe을 선택한 뒤 "오늘 할 일 보여줘"라고 말해 확인합니다.',
    ],
  },
];

function formatMoment(iso: string): string {
  const moment = Temporal.Instant.from(iso).toZonedDateTimeISO(deviceTimeZone());
  return moment.month + '월 ' + moment.day + '일 ' + formatTime(moment.hour * 60 + moment.minute);
}

async function shareAddress(url: string) {
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(url);
      showToast('주소를 복사했습니다.');
    } else {
      await Share.share({ message: url });
    }
  } catch {
    showToast('주소를 길게 눌러 직접 복사해 주세요.', { tone: 'error' });
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
        <Txt tone="muted">
          Claude나 ChatGPT에 연결 주소를 등록하면, 대화만으로 할 일과 습관을 보고 추가·수정·완료·삭제할 수 있습니다.
        </Txt>

        {fresh ? (
          <Card style={{ gap: space.md, borderColor: colors.accent }}>
            <View style={{ gap: 2 }}>
              <Txt variant="bodyStrong">{fresh.label} 연결 주소</Txt>
              <Txt variant="small" tone="danger">
                지금만 볼 수 있습니다. 이 주소를 아는 사람은 누구나 내 할 일을 읽고 고치고 지울 수 있으니 AI 설정 화면에만 붙여 넣어 주세요.
              </Txt>
            </View>
            <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: space.md }}>
              <Txt variant="small" selectable accessibilityLabel="연결 주소">{fresh.url}</Txt>
            </View>
            <Button label={Platform.OS === 'web' ? '주소 복사' : '주소 복사 · 보내기'} icon="share-2" onPress={() => void shareAddress(fresh.url)} />
            <Button label="등록을 마쳤습니다" kind="secondary" onPress={() => setFresh(null)} />
          </Card>
        ) : (
          <View style={{ gap: space.sm }}>
            <Button
              label="새 연결 주소 만들기" icon="plus" loading={create.isPending} disabled={full || isPending}
              onPress={() => setChoosing(true)} />
            {full ? <Txt variant="small" tone="muted">연결은 {MAX_CONNECTIONS}개까지 만들 수 있습니다. 쓰지 않는 연결을 해제해 주세요.</Txt> : null}
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">연결된 AI</Txt>
          {isPending ? <Loading /> : isError && !connections ? (
            <Card style={{ gap: space.md }}>
              <Txt tone="muted">연결 목록을 불러오지 못했습니다. 네트워크를 확인해 주세요.</Txt>
              <Button label="다시 시도" kind="secondary" onPress={() => void refetch()} />
            </Card>
          ) : connections?.length ? (
            <Card style={{ gap: space.md }}>
              {connections.map((connection) => (
                <View key={connection.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={1}>{connection.label}</Txt>
                    <Txt variant="small" tone="muted">
                      {connection.last_used_at ? '마지막 사용 ' + formatMoment(connection.last_used_at) : '아직 사용하지 않음'}
                      {' · 만든 날 ' + formatMoment(connection.created_at)}
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
                  <Txt variant="small" tone="accent">{index + 1}</Txt>
                  <Txt variant="small" tone="muted" style={{ flex: 1 }}>{step}</Txt>
                </View>
              ))}
            </Card>
          ))}
          <Txt variant="small" tone="faint">
            메뉴 이름은 각 서비스의 업데이트에 따라 달라질 수 있습니다. AI가 바꾼 내용은 앱을 다시 열면 반영됩니다.
          </Txt>
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
          해제하면 이 주소로는 더 이상 접근할 수 없습니다. 다시 쓰려면 새 주소를 만들어 AI에 다시 등록해야 합니다.
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
