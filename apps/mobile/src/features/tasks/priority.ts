import type { Priority } from '../../lib/shared';

// Priority words, the same everywhere the app names a priority (sheets, menus, badges). Pure, so node:test runs it.

export const PRIORITY_LABELS: Record<Priority, string> = { 1: '가장 높음', 2: '높음', 3: '보통', 4: '없음' };

/** "가장 높음", "높음", "보통", "없음". */
export const priorityLabel = (priority: Priority): string => PRIORITY_LABELS[priority];

/** The screen-reader label for a priority badge or button: "우선순위 높음". */
export const priorityA11y = (priority: Priority): string => '우선순위 ' + PRIORITY_LABELS[priority];

/**
 * The priority as a mark before the title, the way Apple Reminders shows it: "!!!", "!!", "!", or nothing for 없음.
 * Its length is the signal, so it needs no colour and survives greyscale and colour-blindness.
 */
export const PRIORITY_MARKS: Record<Priority, string> = { 1: '!!!', 2: '!!', 3: '!', 4: '' };

export const priorityMark = (priority: Priority): string => PRIORITY_MARKS[priority];

/** A chip or option label with its mark: "!!! 가장 높음", "!! 높음", "! 보통", "없음". */
export const priorityOption = (priority: Priority): string =>
  (priority < 4 ? PRIORITY_MARKS[priority] + ' ' : '') + PRIORITY_LABELS[priority];

/** A task's screen-reader label: the priority first when there is one ("우선순위 높음, 디자인 리뷰 피드백 정리"). */
export const taskA11yLabel = (title: string, priority: Priority): string =>
  priority < 4 ? priorityA11y(priority) + ', ' + title : title;
