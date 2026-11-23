import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { IconName } from '@/components/ui';
import type { Priority } from '@/lib/shared';

export interface ChecklistTemplate {
  id: string;
  title: string;
  icon: IconName;
  notes?: string;
  priority?: Priority;
  items: string[];
  builtin?: boolean;
}

export const builtinTemplates: ChecklistTemplate[] = [
  {
    id: 'builtin-travel',
    title: '여행 짐싸기',
    icon: 'briefcase',
    builtin: true,
    items: ['신분증 · 여권 · 지갑', '충전기 · 보조배터리 · 멀티어댑터', '속옷 · 양말 · 여벌 옷', '세면도구 · 상비약', '숙소 · 교통 예약 확인', '집 문단속 · 가스 · 콘센트 확인'],
  },
  {
    id: 'builtin-grocery',
    title: '주간 장보기',
    icon: 'shopping-cart',
    builtin: true,
    items: ['계란 · 우유 · 두부', '채소 · 과일', '고기 · 생선', '쌀 · 면 · 빵', '휴지 · 세제 · 생필품'],
  },
  {
    id: 'builtin-morning',
    title: '외출 · 출근 전 체크',
    icon: 'sunrise',
    builtin: true,
    items: ['휴대폰 · 지갑 · 이어폰', '차 키 · 사원증', '날씨 확인 (우산/겉옷)', '전등 · 냉난방기 끄기'],
  },
  {
    id: 'builtin-meeting',
    title: '회의 준비 · 정리',
    icon: 'users',
    builtin: true,
    items: ['안건 및 자료 사전 공유', '핵심 질문 3가지 정리', '회의록 작성', '결정 사항 · 액션 아이템 등록'],
  },
  {
    id: 'builtin-weekly-review',
    title: '주간 회고 (GTD)',
    icon: 'compass',
    builtin: true,
    items: ['미분류 항목 전부 정리하기', '지연된 할 일 재조정 또는 삭제', '다음 주 달력 일정 확인', '이번 주 완료한 일 돌아보기', '다음 주 핵심 목표 3가지 정하기'],
  },
  {
    id: 'builtin-deploy',
    title: '릴리스 · 배포 점검',
    icon: 'check-square',
    builtin: true,
    items: ['테스트 · 린트 · 타입체크 통과', '변경 로그 · 버전 확인', '환경 변수 · 설정 확인', '배포 후 핵심 플로우 스모크 테스트'],
  },
];

const KEY = 'dayframe-checklist-templates';
let customTemplates: ChecklistTemplate[] = [];
let loaded: Promise<ChecklistTemplate[]> | undefined;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function loadCustomTemplates(): Promise<ChecklistTemplate[]> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return customTemplates;
      const parsed = JSON.parse(raw) as ChecklistTemplate[];
      if (Array.isArray(parsed)) customTemplates = parsed;
      notify();
      return customTemplates;
    })
    .catch(() => customTemplates);
  return loaded;
}

export function saveCustomTemplate(template: Omit<ChecklistTemplate, 'id' | 'builtin'>): ChecklistTemplate {
  const created: ChecklistTemplate = {
    ...template,
    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    builtin: false,
  };
  customTemplates = [created, ...customTemplates];
  loaded = Promise.resolve(customTemplates);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(customTemplates)).catch(() => {});
  return created;
}

export function deleteCustomTemplate(id: string): void {
  customTemplates = customTemplates.filter((item) => item.id !== id);
  loaded = Promise.resolve(customTemplates);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(customTemplates)).catch(() => {});
}

export function useChecklistTemplates(): { custom: ChecklistTemplate[]; builtin: ChecklistTemplate[] } {
  const custom = useSyncExternalStore((listener) => {
    listeners.add(listener);
    void loadCustomTemplates();
    return () => { listeners.delete(listener); };
  }, () => customTemplates, () => customTemplates);
  return { custom, builtin: builtinTemplates };
}
