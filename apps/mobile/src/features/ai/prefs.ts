import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { type AiModelId, DEFAULT_MODEL, isModelId } from './models';
import type { WeeklyReview } from './schemas';
import type { ReviewRange } from './review';

// AI settings that are not secret: the chosen model and the day window for 하루 계획. Kept on this phone.
export interface AiPrefs {
  model: AiModelId;
  /** 하루 시작 / 하루 끝, minutes after midnight. */
  dayStart: number;
  dayEnd: number;
}

const KEY = 'dayframe-ai-prefs-v1';
const DEFAULTS: AiPrefs = { model: DEFAULT_MODEL, dayStart: 9 * 60, dayEnd: 22 * 60 };

let prefs: AiPrefs = DEFAULTS;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function accept(raw: unknown): Partial<AiPrefs> {
  if (typeof raw !== 'object' || raw === null) return {};
  const value = raw as Record<string, unknown>;
  const minutes = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 24 * 60 ? v : undefined);
  const result: Partial<AiPrefs> = {};
  if (isModelId(value.model)) result.model = value.model;
  const start = minutes(value.dayStart);
  const end = minutes(value.dayEnd);
  if (start !== undefined && end !== undefined && end > start) Object.assign(result, { dayStart: start, dayEnd: end });
  return result;
}

function ensureLoaded(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      prefs = { ...prefs, ...accept(JSON.parse(raw)) };
      listeners.forEach((listener) => listener());
    })
    .catch(() => {});
  return loaded;
}

export async function readAiPrefs(): Promise<AiPrefs> {
  await ensureLoaded();
  return prefs;
}

export function setAiPrefs(patch: Partial<AiPrefs>): void {
  prefs = { ...prefs, ...patch };
  listeners.forEach((listener) => listener());
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export function useAiPrefs(): AiPrefs {
  void ensureLoaded();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => prefs,
    () => prefs,
  );
}

// The last weekly review, so reopening the screen shows it again without a new (paid) request.
const REVIEW_KEY = 'dayframe-ai-review-v1';

export interface CachedReview {
  range: ReviewRange;
  createdAt: string;
  model: AiModelId;
  usage: { input: number; output: number };
  review: WeeklyReview;
}

export async function readCachedReview(): Promise<CachedReview | null> {
  try {
    const raw = await AsyncStorage.getItem(REVIEW_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedReview;
    return value && value.review && typeof value.review.headline === 'string' && value.range ? value : null;
  } catch {
    return null;
  }
}

export function saveCachedReview(review: CachedReview): void {
  AsyncStorage.setItem(REVIEW_KEY, JSON.stringify(review)).catch(() => {});
}
