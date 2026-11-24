import type { Priority } from '../../lib/shared';

// Priority words, the same everywhere the app names a priority (sheets, menus, badges). Pure, so node:test runs it.

export const PRIORITY_LABELS: Record<Priority, string> = { 1: '가장 높음', 2: '높음', 3: '보통', 4: '없음' };

/** "가장 높음", "높음", "보통", "없음". */
export const priorityLabel = (priority: Priority): string => PRIORITY_LABELS[priority];

/** The screen-reader label for a priority badge or button: "우선순위 높음". */
export const priorityA11y = (priority: Priority): string => '우선순위 ' + PRIORITY_LABELS[priority];
