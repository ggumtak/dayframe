import { Platform, View } from 'react-native';

import { Button, Card, Icon, ProgressBar, Txt } from '@/components/ui';
import { space, useTheme } from '@/theme';

import { useUpdate } from './useUpdate';

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
  const busy = phase.name === 'downloading' || phase.name === 'installing';
  const current = (installed.version ?? '알 수 없음') + (installed.build ? ` (${installed.build})` : '');

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{update.available ? `새 버전 ${release?.version}` : '최신 버전입니다'}</Txt>
          <Txt variant="small" tone="muted">현재 {current} · {update.isChecking ? '확인 중…' : checkedLabel(update.lastChecked)}</Txt>
        </View>
        <Icon
          name={update.available ? 'download-cloud' : 'check-circle'} size={24}
          color={update.available ? colors.accent : colors.success} />
      </View>

      {update.checkFailed && !update.isChecking ? (
        <Txt variant="small" tone="danger">업데이트 정보를 가져오지 못했습니다. 네트워크를 확인해 주세요.</Txt>
      ) : null}

      {update.available && release?.notes ? (
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: 10, padding: space.md, gap: 4 }}>
          <Txt variant="caption" tone="muted">변경 사항</Txt>
          <Txt variant="small" numberOfLines={12}>{release.notes}</Txt>
        </View>
      ) : null}

      {update.required ? (
        <Txt variant="small" style={{ color: colors.warning }}>이 버전은 더 이상 지원되지 않습니다. 계속 쓰려면 업데이트해 주세요.</Txt>
      ) : null}

      {phase.name === 'permission' ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="small" tone="muted">
            처음 한 번만 허용이 필요합니다. 설정에서 ‘이 출처 허용’을 켜고 돌아오면 다운로드가 바로 시작됩니다.
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

      {update.available && update.action === 'none' ? (
        <Txt variant="small" tone="muted">
          {Platform.OS === 'ios' ? 'iOS 배포 링크(TestFlight)가 등록되면 여기에서 바로 열 수 있습니다.'
            : Platform.OS === 'web' ? '앱 설치는 Android 기기에서 진행해 주세요.' : '이 릴리스의 설치 파일이 아직 올라오지 않았습니다.'}
        </Txt>
      ) : null}

      {phase.name === 'permission' || busy ? null : (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {update.action !== 'none' ? (
            <Button
              label={update.action === 'store' ? '스토어에서 업데이트' : phase.name === 'error' ? '다시 시도' : '지금 업데이트'}
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
