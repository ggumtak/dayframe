import { Platform, View } from 'react-native';

import { Button, Card, Icon, ProgressBar, Txt } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { useOtaPending } from './ota';
import { useUpdate } from './useUpdate';
import { updateDateLabel } from './version';

function checkedLabel(timestamp: number): string {
  if (!timestamp) return '아직 확인하지 않았습니다';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '방금 확인함';
  if (minutes < 60) return minutes + '분 전 확인함';
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + '시간 전 확인함' : Math.floor(hours / 24) + '일 전 확인함';
}

/** Settings card: current version, the check button, release notes, and the update flow itself. */
export function UpdateCard() {
  const { colors } = useTheme();
  const update = useUpdate();
  const { release, phase, installed } = update;
  // Downloaded by this check, or in the background when the app started.
  const otaReady = useOtaPending() || update.ota === 'ready';
  const busy = phase.name === 'downloading' || phase.name === 'installing';
  // "1.9.0 · 11월 24일 업데이트" while running an over-the-air update, "1.9.0 (10900)" on the APK's own code.
  const updated = updateDateLabel(update.runningUpdateDate, new Date());
  const current = (installed.version ?? '알 수 없음') + (updated ? ` · ${updated}` : installed.build ? ` (${installed.build})` : '');
  const title = otaReady ? '업데이트 준비됨' : update.available ? `새 버전 ${release?.version}` : '최신 버전입니다';

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{title}</Txt>
          <Txt variant="small" tone="muted">현재 {current} · {update.isChecking ? '확인 중…' : checkedLabel(update.lastChecked)}</Txt>
        </View>
        <Icon
          name={otaReady || update.available ? 'download-cloud' : 'check-circle'} size={24}
          color={colors.textMuted} />
      </View>

      {update.checkFailed && !update.isChecking ? (
        <Txt variant="small" tone="danger">업데이트 정보를 가져오지 못했습니다. 인터넷 연결을 확인해 주세요.</Txt>
      ) : null}

      {otaReady ? (
        <Txt variant="small" tone="muted">새 버전을 내려받았습니다. 다시 시작하면 바로, 아니면 다음에 앱을 열 때 적용됩니다.</Txt>
      ) : null}
      {update.ota === 'downloading' ? <Txt variant="small" tone="muted" accessibilityLiveRegion="polite">새 버전을 내려받는 중…</Txt> : null}

      {!otaReady && update.available && release?.notes ? (
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: 10, padding: space.md, gap: 4 }}>
          <Txt variant="caption" tone="muted">변경 사항</Txt>
          <Txt variant="small" numberOfLines={12}>{release.notes}</Txt>
        </View>
      ) : null}

      {update.required ? (
        <Txt variant="smallStrong">이 버전은 더 이상 지원되지 않습니다. 계속 쓰려면 업데이트해 주세요.</Txt>
      ) : null}

      {phase.name === 'permission' ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="small" tone="muted">
            처음 한 번만 허용하면 됩니다. 설정에서 ‘이 출처 허용’을 켜고 돌아오면 바로 다운로드를 시작합니다.
          </Txt>
          <Button label="설치 권한 설정 열기" icon="shield" onPress={update.openPermissionSettings} />
          <Button label="취소" kind="ghost" onPress={update.cancel} />
        </View>
      ) : null}

      {phase.name === 'downloading' ? (
        <View style={{ gap: space.sm }}>
          <ProgressBar value={phase.progress ?? 0} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt variant="small" tone="muted" accessibilityLiveRegion="polite">
              {phase.progress === null ? '다운로드 중…' : `다운로드 중 ${Math.round(phase.progress * 100)}%`}
            </Txt>
            <Button label="취소" kind="ghost" onPress={update.cancel} style={{ minHeight: 32, paddingHorizontal: space.sm }} />
          </View>
        </View>
      ) : null}

      {phase.name === 'installing' ? <Txt variant="small" tone="muted">설치 화면을 여는 중…</Txt> : null}
      {phase.name === 'error' ? <Txt variant="small" tone="danger" accessibilityLiveRegion="polite">{phase.message}</Txt> : null}

      {!otaReady && update.available && update.action === 'none' ? (
        <Txt variant="small" tone="muted">
          {Platform.OS === 'web' ? '앱 설치는 Android 기기에서 진행해 주세요.' : '이 버전의 설치 파일이 아직 올라오지 않았습니다.'}
        </Txt>
      ) : null}

      {phase.name === 'permission' || busy ? null : otaReady ? (
        <Button label="다시 시작해 적용" icon="rotate-cw" onPress={update.restart} />
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {update.action !== 'none' ? (
            <Button
              label={phase.name === 'error' ? '다시 시도' : '지금 업데이트'}
              icon="download" onPress={update.start} style={{ flex: 1 }} />
          ) : null}
          <Button
            label="업데이트 확인" kind={update.action === 'none' ? 'primary' : 'secondary'} icon="refresh-cw"
            loading={update.isChecking} onPress={update.check} style={{ flex: 1 }} />
        </View>
      )}
    </Card>
  );
}
