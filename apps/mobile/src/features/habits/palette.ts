/**
 * The look a habit can take: a curated emoji set and cheering lines to suggest. Pure data and helpers, free of
 * React Native so they can be tested.
 */

/**
 * Colours earlier versions let a habit wear. They stay as data (stored looks and the gallery's routines keep them),
 * but are no longer offered or drawn: habit grids use the accent alone, where colour means "done".
 */
export const HABIT_COLORS = [
  '#3574F0', // 파랑
  '#1F9D63', // 초록
  '#E5870B', // 주황
  '#DC4C3E', // 빨강
  '#7C5CFF', // 보라
  '#0EA5A4', // 청록
  '#D9468F', // 분홍
  '#64748B', // 슬레이트
] as const;

export type HabitColor = (typeof HABIT_COLORS)[number];

export const HABIT_EMOJIS = [
  '💧', '🏃', '🧘', '📚', '✍️', '🥗', '🍎', '💊', '😴', '🌅',
  '🛏️', '🧹', '🪴', '💪', '🚶', '🚴', '🏊', '🧠', '🎧', '🎨',
  '💻', '🗣️', '📝', '💰', '🦷', '🧴', '☕', '📵', '🙏', '❤️',
] as const;

/** Lines to cheer oneself on, offered in turn by the refresh button on the new-habit form. */
export const HABIT_QUOTES = [
  '작은 하루가 쌓여 내가 된다',
  '오늘의 한 번이면 충분해요',
  '완벽보다 꾸준함',
  '어제보다 조금 더 나은 나',
  '천천히, 그래도 멈추지 않기',
  '하다 보면 습관이 된다',
  '오늘도 나와의 약속',
  '빠진 날이 있어도 다시 시작',
  '작게 시작해서 길게 가기',
  '지금 이 순간에 집중',
] as const;

/** The next suggestion after `current`; starts at the first when `current` is not a suggestion. */
export function nextQuote(current: string): string {
  const index = HABIT_QUOTES.indexOf(current.trim() as (typeof HABIT_QUOTES)[number]);
  return HABIT_QUOTES[(index + 1) % HABIT_QUOTES.length];
}

/** The first visible character of a name, for an avatar without an emoji ("물 2리터" gives "물"). */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  const [first] = Array.from(trimmed);
  return first.toUpperCase();
}

export const isHabitColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
