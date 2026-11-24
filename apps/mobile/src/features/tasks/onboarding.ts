import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const KEY = 'dayframe-onboarding-dismissed-v1';
let dismissed = true; // Stay hidden until storage confirms first run, preventing flashes for returning users.
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      dismissed = raw === '1';
      notify();
    })
    .catch(() => {});
}

export function dismissOnboarding(): void {
  dismissed = true;
  notify();
  AsyncStorage.setItem(KEY, '1').catch(() => {});
}

export function useOnboardingDismissed(): boolean {
  ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => dismissed,
    () => true,
  );
}

export const STARTER_CHECKLIST = {
  title: 'Dayframe 5분 둘러보기',
  notes: '아래 하위 작업을 하나씩 체크하거나, 할 일을 오른쪽으로 밀어 완료해 보세요!',
  durationMinutes: 15,
  items: [
    '할 일을 오른쪽으로 밀어 완료해 보기',
    '아래 + 버튼을 눌러 "내일 오후 3시 30분간 독서 p2"처럼 말하듯 적어 보기',
    '오늘 탭 위쪽에서 타임라인으로 바꾸고, 블록을 길게 눌러 시간 옮겨 보기',
    '목록 탭에서 목록의 색·아이콘을 바꾸고 체크리스트 템플릿 써 보기',
  ],
};
