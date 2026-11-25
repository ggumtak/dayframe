import { type Href, router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Header, Icon, type IconName, IconButton, Row, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useNewTaskDate, useProfile, useSession } from '@/data/session';
import { AI_ROUTES, useAiKeyStatus } from '@/features/ai';
import { useKeyboard, useScreenContext } from '@/features/keyboard';
import { RemindersCard } from '@/features/reminders/RemindersCard';
import { accentPalette, MODE_LABELS } from '@/features/settings/palettes';
import { hiddenTabs, TAB_ICONS, TAB_LABELS, visibleTabs } from '@/features/settings/tabBar';
import { useTabBarConfig } from '@/features/settings/tabBarStore';
import { UpdateCard } from '@/features/update/UpdateCard';
import { deviceTimeZone } from '@/lib/dates';
import { env } from '@/lib/env';
import type { NewTaskDate } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

export default function Settings() {
  const { colors, mode, accent } = useTheme();
  const { account, signOut } = useSession();
  const { data: profile } = useProfile();
  const [confirm, setConfirm] = useState(false);
  const [newTaskDate, setNewTaskDate] = useNewTaskDate();
  const tabBar = useTabBarConfig();
  const hidden = hiddenTabs(tabBar);
  const aiKey = useAiKeyStatus();
  const { openHelp } = useKeyboard();
  const email = account?.email ?? '';

  useScreenContext('settings');

  return (
    <Screen>
      <Header title="설정" left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 }}>
        <Card style={styles.account}>
          <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
            <Txt variant="heading">{email ? email[0].toUpperCase() : '?'}</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong" numberOfLines={1} accessibilityLabel={`이메일 ${email}`}>{email}</Txt>
            <View style={styles.inline}>
              <Icon name="globe" size={13} color={colors.textMuted} />
              <Txt variant="small" tone="muted" numberOfLines={1} accessibilityLabel={`시간대 ${profile?.timezone ?? deviceTimeZone()}`}>
                {profile?.timezone ?? deviceTimeZone()}
              </Txt>
            </View>
          </View>
        </Card>

        <Group title="앱 업데이트">
          <UpdateCard />
        </Group>

        <Group title="화면">
          <Card style={styles.list}>
            <LinkRow
              icon="sidebar" label="탭 바" href="/tab-bar"
              detail={hidden.length ? `탭 ${visibleTabs(tabBar).length}개 표시 · ${hidden.length}개 숨김` : `탭 ${visibleTabs(tabBar).length}개 표시`} />
            <LinkRow icon="droplet" label="테마" href="/appearance" detail={`${MODE_LABELS[mode]} · ${accentPalette(accent).label}`} />
            <Row
              icon="command" label="키보드 단축키" detail="? 키로 언제든 보기"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={openHelp} />
          </Card>
        </Group>

        <Group title="새 할 일 기본 날짜">
          <Segmented<NewTaskDate>
            value={newTaskDate} onChange={setNewTaskDate}
            options={[{ value: 'today', label: '오늘로 지정', icon: 'sun' }, { value: 'none', label: '지정 안 함', icon: 'list' }]} />
          <Txt variant="small" tone="muted">
            {newTaskDate === 'today'
              ? '날짜를 따로 입력하지 않아도 오늘 할 일로 추가됩니다. AI로 추가한 할 일도 같으며, 입력창에서 ‘오늘 ×’를 누르면 날짜 없이 저장할 수 있습니다.'
              : '날짜를 입력하지 않으면 목록 탭에만 저장됩니다. 단, 오늘 탭에서 추가할 때는 오늘 날짜로 지정됩니다.'}
          </Txt>
        </Group>

        <Group title="알림">
          <RemindersCard />
        </Group>

        <Group title="기능">
          <Card style={styles.list}>
            <LinkRow icon="zap" label="AI 비서" detail={aiKey.ready && !aiKey.hasKey ? 'API 키 필요' : undefined} href={AI_ROUTES.hub} />
            <LinkRow icon="cpu" label="AI 연결" detail="Claude · ChatGPT" href="/ai" />
            <LinkRow icon="check-circle" label="완료한 일" detail="전체 완료 기록" href="/completed" />
            <LinkRow icon="star" label="습관 갤러리" detail="추천 습관 둘러보기" href="/routines" />
          </Card>
        </Group>

        {hidden.length ? (
          <Group title="숨긴 탭">
            <Card style={styles.list}>
              {hidden.map((tab) => (
                <LinkRow key={tab} icon={TAB_ICONS[tab]} label={TAB_LABELS[tab]} detail="탭 바에서 숨김" href={`/${tab}`} navigate />
              ))}
            </Card>
          </Group>
        ) : null}

        <Group title="계정">
          <Card style={styles.list}>
            <Row icon="github" label="업데이트 기록" detail={env.githubRepo} onPress={() => void Linking.openURL('https://github.com/' + env.githubRepo + '/releases')} />
            <Row icon="log-out" label="로그아웃" tone="danger" onPress={() => setConfirm(true)} />
          </Card>
        </Group>
      </ScrollView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="로그아웃할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>
          로그아웃하면 이 기기의 데이터가 지워집니다. 오프라인에서 변경해 아직 동기화되지 않은 내용도 함께 사라집니다.
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="section" tone="muted" accessibilityRole="header">{title}</Txt>
      {children}
    </View>
  );
}

/**
 * A settings row that opens another screen. `navigate` is for tab screens: it goes to the tab inside the
 * existing tab navigator, the way the habit screen opens 집중, rather than pushing a second copy.
 */
function LinkRow({ icon, label, detail, href, navigate }: { icon: IconName; label: string; detail?: string; href: Href; navigate?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row
      icon={icon} label={label} detail={detail}
      trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
      onPress={() => (navigate ? router.navigate(href) : router.push(href))} />
  );
}

const styles = StyleSheet.create({
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { paddingVertical: space.xs },
});
