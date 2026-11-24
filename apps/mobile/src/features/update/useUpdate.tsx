import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { keys } from '@/data/keys';
import { haptic } from '@/lib/haptics';

import { fetchLatestRelease, installedApp } from './check';
import {
  canSelfUpdate, downloadApk, hasInstallPermission, installApk, openInstallPermissionSettings, UpdateError,
} from './installer';
import { type InstalledApp, isNewer, isRequired, type ReleaseInfo, type UpdateFailure } from './version';

export type UpdatePhase =
  | { name: 'idle' }
  | { name: 'permission' }
  | { name: 'downloading'; progress: number | null }
  | { name: 'installing' }
  | { name: 'error'; message: string };

interface UpdateValue {
  installed: InstalledApp;
  release: ReleaseInfo | null;
  available: boolean;
  required: boolean;
  isChecking: boolean;
  checkFailed: boolean;
  lastChecked: number;
  phase: UpdatePhase;
  /** Whether "update now" can download and install the release on this device. */
  action: 'install' | 'none';
  check: () => void;
  start: () => void;
  cancel: () => void;
  openPermissionSettings: () => void;
}

const messages: Record<UpdateFailure, string> = {
  untrusted: '이 버전에는 설치 파일이 없습니다. 잠시 후 다시 확인해 주세요.',
  download: '다운로드하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.',
  'wrong-app': '다른 앱의 설치 파일이어서 설치를 중단했습니다.',
  'wrong-signer': '서명이 현재 앱과 달라 덮어쓸 수 없습니다. 기존 앱을 삭제한 뒤 새로 설치해야 합니다.',
  'not-newer': '내려받은 파일이 현재 버전보다 새롭지 않습니다.',
  unreadable: '내려받은 파일이 손상되었습니다. 다시 시도해 주세요.',
  cancelled: '',
};

const UpdateContext = createContext<UpdateValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const installed = useMemo(() => installedApp(), []);
  const query = useQuery({
    queryKey: keys.update, queryFn: fetchLatestRelease, staleTime: 6 * 60 * 60 * 1000, retry: 1,
    // A stale answer from a previous install must not advertise an update that is already applied.
    meta: { persist: false },
  });
  const release = query.data ?? null;
  const [phase, setPhase] = useState<UpdatePhase>({ name: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const available = !!release && isNewer(release, installed);
  const action: UpdateValue['action'] = available && canSelfUpdate && release?.apkUrl ? 'install' : 'none';

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
    installed, release, available, required: !!release && available && isRequired(release, installed),
    isChecking: query.isFetching, checkFailed: query.isError, lastChecked: query.dataUpdatedAt, phase, action,
    check: () => {
      setPhase({ name: 'idle' });
      void query.refetch();
    },
    start,
    cancel: () => {
      abort.current?.abort();
      setPhase({ name: 'idle' });
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
