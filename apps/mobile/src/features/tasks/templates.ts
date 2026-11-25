import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { IconName } from '@/components/ui';
import { registerAccountStoreReset } from '@/lib/localStore';
import type { Priority } from '@/lib/shared';

export interface ChecklistTemplate {
  id: string;
  title: string;
  icon: IconName;
  notes?: string;
  priority?: Priority;
  defaultDurationMinutes?: number;
  tags?: string[];
  items: string[];
  builtin?: boolean;
}

export const builtinTemplates: ChecklistTemplate[] = [
  {
    id: 'builtin-travel',
    title: '여행 짐 싸기',
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
    items: ['휴대폰 · 지갑 · 이어폰', '차 키 · 사원증', '날씨 확인 (우산 · 겉옷)', '전등 · 냉난방기 끄기'],
  },
  {
    id: 'builtin-meeting',
    title: '회의 준비 · 정리',
    icon: 'users',
    builtin: true,
    items: ['안건 · 자료 미리 공유', '핵심 질문 3가지 정리', '회의록 작성', '결정 사항 · 후속 할 일 정리'],
  },
  {
    id: 'builtin-weekly-review',
    title: '주간 돌아보기',
    icon: 'compass',
    builtin: true,
    items: ['미분류 할 일 모두 정리하기', '기한이 지난 할 일 일정 다시 정리하기', '다음 주 달력 일정 확인', '이번 주 완료한 일 돌아보기', '다음 주 핵심 목표 3가지 정하기'],
  },
  {
    id: 'builtin-deploy',
    title: '릴리스 · 배포 점검',
    icon: 'check-square',
    builtin: true,
    items: ['테스트 · 린트 · 타입 체크 통과', '변경 내역 · 버전 확인', '환경 변수 · 설정 확인', '배포 후 핵심 기능 점검'],
  },
];

const KEY = 'dayframe-checklist-templates';
let customTemplates: ChecklistTemplate[] = [];
let loaded: Promise<ChecklistTemplate[]> | undefined;
let changedBeforeLoad = false;
let loadGeneration = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function sanitizeTemplate(raw: unknown): ChecklistTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.title !== 'string') return null;
  const items = Array.isArray(obj.items)
    ? obj.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : undefined;
  const defaultDurationMinutes = typeof obj.defaultDurationMinutes === 'number'
    && Number.isFinite(obj.defaultDurationMinutes)
    && obj.defaultDurationMinutes > 0
    ? Math.round(obj.defaultDurationMinutes)
    : undefined;
  const priority = obj.priority === 1 || obj.priority === 2 || obj.priority === 3 || obj.priority === 4
    ? obj.priority
    : undefined;
  return {
    id: obj.id,
    title: obj.title,
    icon: (typeof obj.icon === 'string' ? obj.icon : 'check-square') as IconName,
    ...(typeof obj.notes === 'string' && obj.notes.trim() ? { notes: obj.notes } : {}),
    ...(priority ? { priority } : {}),
    ...(defaultDurationMinutes ? { defaultDurationMinutes } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    items,
    builtin: false,
  };
}

export function loadCustomTemplates(): Promise<ChecklistTemplate[]> {
  if (!loaded) {
    const generation = loadGeneration;
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (generation !== loadGeneration || changedBeforeLoad || !raw) return customTemplates;
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          customTemplates = parsed.map(sanitizeTemplate).filter((item): item is ChecklistTemplate => item !== null);
          notify();
        }
        return customTemplates;
      })
      .catch(() => customTemplates);
  }
  return loaded;
}

export function saveCustomTemplate(template: Omit<ChecklistTemplate, 'id' | 'builtin'>): ChecklistTemplate {
  const tags = template.tags?.map((tag) => tag.trim()).filter(Boolean);
  const defaultDurationMinutes = typeof template.defaultDurationMinutes === 'number'
    && Number.isFinite(template.defaultDurationMinutes)
    && template.defaultDurationMinutes > 0
    ? Math.round(template.defaultDurationMinutes)
    : undefined;
  const created: ChecklistTemplate = {
    title: template.title,
    icon: template.icon,
    items: template.items,
    ...(template.notes?.trim() ? { notes: template.notes } : {}),
    ...(template.priority ? { priority: template.priority } : {}),
    ...(defaultDurationMinutes ? { defaultDurationMinutes } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    builtin: false,
  };
  changedBeforeLoad = true;
  customTemplates = [created, ...customTemplates];
  loaded = Promise.resolve(customTemplates);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(customTemplates)).catch(() => {});
  return created;
}

export function deleteCustomTemplate(id: string): void {
  changedBeforeLoad = true;
  customTemplates = customTemplates.filter((item) => item.id !== id);
  loaded = Promise.resolve(customTemplates);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(customTemplates)).catch(() => {});
}

export function restoreCustomTemplate(template: ChecklistTemplate, index = 0): void {
  if (customTemplates.some((item) => item.id === template.id)) return;
  changedBeforeLoad = true;
  const safeIndex = Math.max(0, Math.min(customTemplates.length, index));
  const next = [...customTemplates];
  next.splice(safeIndex, 0, { ...template, builtin: false });
  customTemplates = next;
  loaded = Promise.resolve(customTemplates);
  notify();
  AsyncStorage.setItem(KEY, JSON.stringify(customTemplates)).catch(() => {});
}

export async function resetCustomTemplates(): Promise<void> {
  loadGeneration += 1;
  changedBeforeLoad = false;
  loaded = Promise.resolve([]);
  if (customTemplates.length > 0) {
    customTemplates = [];
    notify();
  }
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

registerAccountStoreReset(() => resetCustomTemplates());

export function useChecklistTemplates(): { custom: ChecklistTemplate[]; builtin: ChecklistTemplate[] } {
  const custom = useSyncExternalStore((listener) => {
    listeners.add(listener);
    void loadCustomTemplates();
    return () => { listeners.delete(listener); };
  }, () => customTemplates, () => customTemplates);
  return { custom, builtin: builtinTemplates };
}
