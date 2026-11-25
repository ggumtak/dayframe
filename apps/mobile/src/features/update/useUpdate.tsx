import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { keys } from '@/data/keys';
import { haptic } from '@/lib/haptics';

import { fetchLatestRelease, installedApp } from './check';
import {
  canSelfUpdate, cleanUpDownloadedApk, downloadApk, hasInstallPermission, installApk, openInstallPermissionSettings, UpdateError,
} from './installer';
import { downloadOta, isOtaAvailable, otaEnabled, restartIntoUpdate, runningUpdateDate } from './ota';
import { type InstalledApp, isNewer, isRequired, type ReleaseInfo, type UpdateFailure } from './version';

export type UpdatePhase =
  | { name: 'idle' }
  | { name: 'permission' }
  | { name: 'downloading'; progress: number | null }
  | { name: 'installing' }
  | { name: 'error'; message: string };

/** The over-the-air side of "업데이트 확인": checked first, before any APK. */
export type OtaPhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'failed';

interface UpdateValue {
  installed: InstalledApp;
  /** When the running over-the-air update was published; null while running the APK's own code. */
  runningUpdateDate: Date | null;
  release: ReleaseInfo | null;
  available: boolean;
  required: boolean;
  isChecking: boolean;
  checkFailed: boolean;
  lastChecked: number;
  phase: UpdatePhase;
  ota: OtaPhase;
  /** Whether "update now" can download and install the release on this device. */
  action: 'install' | 'none';
  check: () => void;
  start: () => void;
  cancel: () => void;
  /** Restarts into the downloaded over-the-air update. */
  restart: () => void;
  openPermissionSettings: () => void;
}

const messages: Record<UpdateFailure, string> = {
  untrusted: '설치 파일을 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.',
  download: '다운로드하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  'wrong-app': '다른 앱의 설치 파일이어서 설치를 중단했습니다.',
  'wrong-signer': '앱 서명이 달라 바로 업데이트할 수 없습니다. 기존 앱을 삭제한 뒤 새로 설치해 주세요.',
  'not-newer': '다운로드한 파일이 현재 버전보다 최신이 아닙니다.',
  unreadable: '다운로드한 파일이 손상되었습니다. 다시 시도해 주세요.',
  cancelled: '',
  restart: '앱을 다시 시작하지 못했습니다. 앱을 완전히 종료한 뒤 다시 열면 적용됩니다.',
};

const UpdateContext = createContext<UpdateValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const installed = useMemo(() => installedApp(), []);
  const updateDate = useMemo(() => runningUpdateDate(), []);
  const query = useQuery({
    queryKey: keys.update, queryFn: fetchLatestRelease, staleTime: 6 * 60 * 60 * 1000, retry: 1,
    // A stale answer from a previous install must not advertise an update that is already applied.
    meta: { persist: false },
  });
  const release = query.data ?? null;
  const [phase, setPhase] = useState<UpdatePhase>({ name: 'idle' });
  const [ota, setOta] = useState<OtaPhase>('idle');
  const [otaCheckedAt, setOtaCheckedAt] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const available = !!release && isNewer(release, installed);
  const action: UpdateValue['action'] = available && canSelfUpdate && release?.apkUrl ? 'install' : 'none';

  // A previous APK update may have left its download in the cache; remove it once start-up has settled.
  useEffect(() => {
    const timer = setTimeout(cleanUpDownloadedApk, 5000);
    return () => clearTimeout(timer);
  }, []);

  const download = async (target: ReleaseInfo) => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ name: 'downloading', progress: 0 });
    try {
      const file = await downloadApk(target, (progress) => setPhase({ name: 'downloading', progress }), controller.signal);
      setPhase({ name: 'installing' });
      haptic.success();
      await installApk(file);
      // The system installer takes over; if the user backs out, the button is ready again.
      setPhase({ name: 'idle' });
    } catch (error) {
      const reason = error instanceof UpdateError ? error.reason : 'download';
      setPhase(reason === 'cancelled' ? { name: 'idle' } : { name: 'error', message: messages[reason] });
      if (reason !== 'cancelled') haptic.warning();
    } finally {
      abort.current = null;
    }
  };
  const resume = useRef(download);
  useEffect(() => {
    resume.current = download;
  });

  /** Over-the-air first: it needs no install. Only when there is none for this build is a new APK looked for. */
  const check = async () => {
    setPhase({ name: 'idle' });
    // A downloaded update is the answer already; restarting applies it.
    if (ota === 'ready') return;
    if (otaEnabled && ota !== 'checking' && ota !== 'downloading') {
      try {
        setOta('checking');
        if (await isOtaAvailable()) {
          setOta('downloading');
          if (await downloadOta()) {
            setOta('ready');
            setOtaCheckedAt(Date.now());
            haptic.success();
            return;
          }
        }
        setOta('idle');
      } catch {
        setOta('failed');
      }
      setOtaCheckedAt(Date.now());
    }
    void query.refetch();
  };

  const start = () => {
    if (!release || phase.name === 'downloading' || phase.name === 'installing') return;
    if (action !== 'install') return;
    if (!hasInstallPermission()) {
      setPhase({ name: 'permission' });
      return;
    }
    void download(release);
  };

  // Coming back from Android's settings with the permission granted continues the update unprompted.
  const waitingForPermission = phase.name === 'permission';
  useEffect(() => {
    if (!waitingForPermission || !release) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasInstallPermission()) void resume.current(release);
    });
    return () => subscription.remove();
  }, [waitingForPermission, release]);

  const value: UpdateValue = {
    installed, runningUpdateDate: updateDate, release, available, required: !!release && available && isRequired(release, installed),
    isChecking: query.isFetching || ota === 'checking' || ota === 'downloading',
    checkFailed: query.isError || ota === 'failed', lastChecked: Math.max(query.dataUpdatedAt, otaCheckedAt), phase, ota, action,
    check: () => void check(),
    start,
    cancel: () => {
      abort.current?.abort();
      setPhase({ name: 'idle' });
    },
    restart: () => {
      restartIntoUpdate().catch(() => setPhase({ name: 'error', message: messages.restart }));
    },
    openPermissionSettings: openInstallPermissionSettings,
  };
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate(): UpdateValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error('useUpdate must be used inside UpdateProvider');
  return value;
}
