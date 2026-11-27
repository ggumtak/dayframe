import { type Href, router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Button, Card, Divider, FoldHeader, Header, Icon, type IconName, IconButton, Row, Screen, Sheet, Txt } from '@/components/ui';
import { useProfile, useSession } from '@/data/session';
import { AI_ROUTES, useAiKeyStatus } from '@/features/ai';
import { useKeyboard, useScreenContext } from '@/features/keyboard';
import { RemindersCard } from '@/features/reminders/RemindersCard';
import { useReminderSettings } from '@/features/reminders/settings';
import { accentPalette, MODE_LABELS } from '@/features/settings/palettes';
import type { Density, PersonalPrefs, StartupTab } from '@/features/settings/prefs';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { hiddenTabs, TAB_ICONS, TAB_LABELS, visibleTabs } from '@/features/settings/tabBar';
import { useTabBarConfig } from '@/features/settings/tabBarStore';
import { useOtaPending } from '@/features/update/ota';
import { UpdateCard } from '@/features/update/UpdateCard';
import { useUpdate } from '@/features/update/useUpdate';
import { deviceTimeZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { radius, space, type, useTheme } from '@/theme';

const DENSITY_LABELS: Record<Density, string> = {
  compact: '컴팩트',
  default: '기본',
  comfortable: '여유롭게',
};

const STARTUP_LABELS: Record<StartupTab, string> = {
  index: '오늘',
  inbox: '목록',
  upcoming: '예정',
  habits: '습관',
  focus: '집중',
  last: '마지막 탭',
};

function summarizePersonalPrefs(prefs: PersonalPrefs): string {
  const parts: string[] = [];
  if (prefs.dayStartHour > 0) parts.push(`야행성 새벽 ${prefs.dayStartHour}시`);
  if (prefs.startOfWeek === 'sunday') parts.push('일요일 시작');
  if (prefs.timeFormat === '24h') parts.push('24시간');
  if (
    prefs.swipeLeft !== 'complete'
    || prefs.swipeRightPrimary !== 'schedule'
    || prefs.swipeRightSecondary !== 'delete'
  ) {
    parts.push('스와이프 맞춤');
  }
  if (prefs.todayHabitsPosition === 'top') parts.push('습관 상단');
  else if (prefs.todayHabitsPosition === 'hidden') parts.push('습관 숨김');
  if (!prefs.singleKeyShortcuts) parts.push('단일 키 끔');
  if (parts.length > 0) return parts.slice(0, 3).join(' · ');
  return '하루 기준 · 제스처 · 빠른 추가';
}

export default function Settings() {
  const { colors, mode, accent } = useTheme();
  const { account, signOut } = useSession();
  const { data: profile } = useProfile();
  const [confirm, setConfirm] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const personal = usePersonalPrefs();
  const tabBar = useTabBarConfig();
  const hidden = hiddenTabs(tabBar);
  const aiKey = useAiKeyStatus();
  const reminderSettings = useReminderSettings();
  const update = useUpdate();
  const otaReady = useOtaPending() || update.ota === 'ready';
  const updateHighlighted = otaReady || update.available || update.phase.name !== 'idle';
  const { openHelp } = useKeyboard();
  const email = account?.email ?? '';

  useScreenContext('settings');

  const personalSummary = useMemo(() => summarizePersonalPrefs(personal), [personal]);

  const tabBarDetail = useMemo(() => {
    const visible = visibleTabs(tabBar).length;
    const base = hidden.length ? `탭 ${visible}개 · ${hidden.length}개 숨김` : `탭 ${visible}개`;
    return personal.startupTab !== 'index' ? `${base} · 시작 ${STARTUP_LABELS[personal.startupTab]}` : base;
  }, [hidden.length, personal.startupTab, tabBar]);

  const reminderDetail = Platform.OS !== 'android' ? 'Android 전용' : reminderSettings.enabled ? '켜짐' : '꺼짐';

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

        {updateHighlighted ? (
          <Group title="앱 업데이트">
            <UpdateCard />
          </Group>
        ) : null}

        <Group title="내 맞춤 설정">
          <Card style={styles.list}>
            <LinkRow
              icon="sliders"
              label="맞춤 설정"
              subtitle={personalSummary}
              href="/personalization" />
            <Divider inset={32} />
            <LinkRow
              icon="droplet"
              label="외관 및 밀도"
              detail={`${MODE_LABELS[mode]} · ${accentPalette(accent).label} · ${DENSITY_LABELS[personal.density]}`}
              href="/appearance" />
            <Divider inset={32} />
            <LinkRow
              icon="sidebar"
              label="탭 바 및 시작 화면"
              detail={tabBarDetail}
              href="/tab-bar" />
            <Divider inset={32} />
            <Row
              icon="command" label="키보드 단축키" detail="? 키로 언제든 보기"
              trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
              onPress={openHelp} />
          </Card>
        </Group>

        <View style={{ gap: space.xs }}>
          <View style={{ marginHorizontal: -space.lg, marginTop: -space.md }}>
            <FoldHeader
              title="알림"
              titleTone="muted"
              detail={reminderDetail}
              open={remindersOpen}
              onToggle={() => setRemindersOpen((open) => !open)}
              label="알림 설정" />
          </View>
          {remindersOpen ? <RemindersCard /> : null}
        </View>

        <Group title="AI · 도구">
          <Card style={styles.list}>
            <LinkRow leading={<AiIcon size={18} color={colors.textMuted} />} label="AI 비서" detail={aiKey.ready && !aiKey.hasKey ? 'API 키 필요' : undefined} href={AI_ROUTES.hub} />
            <Divider inset={32} />
            <LinkRow icon="cpu" label="AI 연결" detail="Claude · ChatGPT" href="/ai" />
            <Divider inset={32} />
            <LinkRow icon="check-circle" label="완료한 일" detail="전체 완료 기록" href="/completed" />
            <Divider inset={32} />
            <LinkRow icon="star" label="습관 갤러리" detail="추천 습관 둘러보기" href="/routines" />
          </Card>
        </Group>

        {hidden.length ? (
          <Group title="숨긴 탭">
            <Card style={styles.list}>
              {hidden.map((tab, index) => (
                <View key={tab}>
                  {index > 0 ? <Divider inset={32} /> : null}
                  <LinkRow icon={TAB_ICONS[tab]} label={TAB_LABELS[tab]} detail="탭 바에서 숨김" href={`/${tab}`} navigate />
                </View>
              ))}
            </Card>
          </Group>
        ) : null}

        <Group title="앱 정보 · 계정">
          {!updateHighlighted ? <UpdateCard /> : null}
          <Card style={styles.list}>
            <Row icon="github" label="업데이트 기록" detail={env.githubRepo} onPress={() => void Linking.openURL('https://github.com/' + env.githubRepo + '/releases')} />
            <Divider inset={32} />
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
function LinkRow({ icon, leading, label, subtitle, detail, href, navigate }: {
  icon?: IconName; leading?: ReactNode; label: string; subtitle?: string; detail?: string; href: Href; navigate?: boolean;
}) {
  const { colors } = useTheme();
  const open = () => (navigate ? router.navigate(href) : router.push(href));
  if (subtitle) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={open}
        style={({ pressed }) => [styles.subtitleRow, pressed && { backgroundColor: colors.surfaceMuted }]}>
        {leading ?? (icon ? <Icon name={icon} size={20} color={colors.textMuted} /> : null)}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.body as TextStyle, { color: colors.text }]} numberOfLines={1}>{label}</Text>
          <Txt variant="small" tone="muted" numberOfLines={1}>{subtitle}</Txt>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textFaint} />
      </Pressable>
    );
  }
  return (
    <Row
      icon={icon} leading={leading} label={label} detail={detail}
      trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
      onPress={open} />
  );
}

const styles = StyleSheet.create({
  account: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { paddingVertical: space.xs },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 58, paddingVertical: space.xs },
});
