// System prompts and user messages for the four features. Pure, tested with node:test.
//
// System prompts are fixed strings: nothing that changes per request (the time, the data) goes in them, so
// they stay byte-identical between requests. Everything that changes is in the user message, wrapped in tags.
import type { PlanCandidate, PlanWindow } from './plan.ts';
import type { WeekFacts } from './review.ts';
import { describeNow, formatHHMM, type NowContext } from './time.ts';

const OWNER = 'You are the assistant inside Dayframe, a personal task, habit and focus app. '
  + 'It has exactly one user, its owner, who writes in Korean. ';

const KOREAN = 'Write every text field in natural, everyday Korean, the way the owner would write it in their own task app: '
  + 'short, concrete, no translationese, no English unless the owner used it. Use 합니다체 for sentences.';

export const ORGANIZE_SYSTEM = OWNER
  + 'The owner has dumped whatever is on their mind into a memo. Turn it into tasks they can add to the app as they are. '
  + 'The app shows your tasks as a preview; the owner ticks which to add, so do not invent work the memo does not contain.\n\n'
  + 'Rules:\n'
  + '- One task per distinct thing to do. Merge duplicates. Skip feelings, context and notes that are not actions.\n'
  + '- title: a short task title, as the owner would type it (e.g. "치과 예약 전화하기", "보고서 초안 제출"). No date or time words in the title.\n'
  + '- date: YYYY-MM-DD only when the memo implies a day ("내일", "금요일까지", "다음 주 월요일"); resolve it from the current date given. Otherwise null.\n'
  + '- time: 24-hour HH:MM only when the memo names a time ("저녁 7시" is 19:00). Otherwise null.\n'
  + '- list: one of the owner\'s existing list names when the task clearly belongs there, otherwise null. Never make up a list.\n'
  + '- priority: 1 only for what the memo marks as urgent or very important, 2 for important, 3 for somewhat, 4 when nothing suggests it.\n'
  + '- duration_minutes: only when the memo states it or it is obvious (a 30-minute call); otherwise null.\n'
  + '- subtasks: concrete steps only when the memo lists them for that task; otherwise an empty array.\n'
  + '- Return an empty tasks array if the memo contains nothing to do.\n\n'
  + KOREAN;

export const PLAN_SYSTEM = OWNER
  + 'Propose a realistic schedule for the rest of today from the owner\'s open tasks. The app shows it as a preview the owner can '
  + 'edit, and applying it sets each task\'s start time (and duration when it had none).\n\n'
  + 'Rules:\n'
  + '- Schedule only within the window given, never before its start (that is now or later).\n'
  + '- Tasks marked fixed keep exactly their time; plan around them.\n'
  + '- No overlaps. Leave short gaps (5–15 minutes) between blocks, longer after long blocks.\n'
  + '- Higher priority (1 is highest) and overdue work earlier, unless a fixed time decides otherwise.\n'
  + '- Use a task\'s own duration when it has one; otherwise estimate a realistic one from its title and notes.\n'
  + '- Keep the total realistic for one person. When everything does not fit, put the lower-priority tasks in left_out with a short reason '
  + '(e.g. "내일로 미루는 편이 낫습니다", "시간이 부족합니다").\n'
  + '- Use only the task ids given. Every task appears once, either in blocks or in left_out.\n'
  + '- note: one or two sentences on how the day is laid out (e.g. what to start with).\n\n'
  + KOREAN;

export const BREAKDOWN_SYSTEM = OWNER
  + 'The owner has a task that feels too big to start. Break it into 3 to 8 concrete steps that the app will add as its subtasks.\n\n'
  + 'Rules:\n'
  + '- Each step is one sitting of work with a clear finish, in order.\n'
  + '- Write each step as a short Korean action phrase the way people write to-dos, ending in a noun or verb stem '
  + '(e.g. "자료 모으기", "목차 정하기", "초안 쓰기"), not a full sentence.\n'
  + '- Use the notes for specifics. Do not repeat or rephrase existing subtasks; add only what is missing.\n'
  + '- minutes: a realistic estimate for the step, or null when it cannot be estimated.\n\n'
  + KOREAN;

export const REVIEW_SYSTEM = OWNER
  + 'Write the owner\'s weekly review from the facts of the last seven days. The app shows it as a short card they read once a week.\n\n'
  + 'Rules:\n'
  + '- Be specific to the data: name the actual tasks, lists, habits and days. No generic productivity advice.\n'
  + '- headline: one sentence that captures the week.\n'
  + '- wins: 2–4 things that went well, each pointing to the facts.\n'
  + '- slipped: up to 4 things that slipped (overdue tasks, missed habits). Kind and factual, never scolding. Empty if nothing slipped.\n'
  + '- patterns: up to 3 patterns you can actually see (days, times, lists). Empty when the data is too thin to say.\n'
  + '- suggestions: 2–4 small, concrete next steps for the coming week. Set as_task true when it is a single action that '
  + 'fits as a task (then title is the task title, e.g. "보고서 초안 30분만 쓰기"); false for a general adjustment.\n'
  + '- Habit marks per day: ● done, ◐ partly, – skipped, ❄ rest day, · nothing logged.\n\n'
  + KOREAN;

/** A one-line, tag-safe rendering of free text written by the owner. */
const line = (text: string) => text.replace(/\s+/g, ' ').replace(/</g, '‹').trim();

export function organizeUser(memo: string, now: NowContext, listNames: string[]): string {
  return [
    describeNow(now),
    '<lists>' + (listNames.length ? listNames.map(line).join(', ') : '(없음)') + '</lists>',
    '<memo>\n' + memo.replace(/<\/memo>/gi, '').trim() + '\n</memo>',
  ].join('\n');
}

export function planUser(now: NowContext, window: PlanWindow, candidates: PlanCandidate[]): string {
  const rows = candidates.map((candidate) => [
    `id=${candidate.id}`,
    `title=${line(candidate.title)}`,
    `priority=${candidate.priority}`,
    candidate.fixedMinutes !== null ? `fixed=${formatHHMM(candidate.fixedMinutes)}` : null,
    candidate.durationMinutes ? `duration=${candidate.durationMinutes}` : null,
    candidate.overdue ? `overdue_since=${candidate.dueDate}` : null,
    candidate.notes ? `notes=${line(candidate.notes).slice(0, 160)}` : null,
  ].filter(Boolean).join(' | '));
  return [
    describeNow(now),
    `<window>${formatHHMM(window.start)}–${formatHHMM(window.end)}</window>`,
    '<tasks>\n' + rows.join('\n') + '\n</tasks>',
  ].join('\n');
}

export function breakdownUser(title: string, notes: string | null, existingSubtasks: string[]): string {
  return [
    `<task>${line(title)}</task>`,
    `<notes>${notes?.trim() ? notes.trim().replace(/<\/notes>/gi, '').slice(0, 2000) : '(없음)'}</notes>`,
    '<existing_subtasks>' + (existingSubtasks.length ? '\n' + existingSubtasks.map((s) => '- ' + line(s)).join('\n') + '\n' : '(없음)')
      + '</existing_subtasks>',
  ].join('\n');
}

export function reviewUser(now: NowContext, facts: WeekFacts): string {
  const listSuffix = (list: string | null) => (list ? ` [${line(list)}]` : '');
  const completed = facts.completed.map((item) => `- ${item.date} ${line(item.title)}${listSuffix(item.list)}`);
  const overdue = facts.overdue.map((item) => `- ${line(item.title)} (마감 ${item.dueDate}, 우선순위 ${item.priority})${listSuffix(item.list)}`);
  const habits = facts.habits.map((habit) => (habit.cadence === 'daily'
    ? `- ${line(habit.name)}: 매일 ${habit.target}회 목표, ${habit.days} (완료 ${habit.doneDays}/7일)`
    : `- ${line(habit.name)}: 주 ${habit.target}회 목표, ${habit.days} (기록 ${habit.doneDays}회)`));
  const focus = facts.focus.map((day) => `${day.date} ${day.minutes}분`);
  return [
    describeNow(now),
    `<range>${facts.range.from} ~ ${facts.range.to}</range>`,
    '<completed>\n' + (completed.join('\n') || '(없음)') + '\n</completed>',
    '<still_overdue>\n' + (overdue.join('\n') || '(없음)') + '\n</still_overdue>',
    '<habits days="' + facts.range.from + '부터 7일">\n' + (habits.join('\n') || '(없음)') + '\n</habits>',
    '<focus>' + focus.join(', ') + '</focus>',
  ].join('\n');
}

/** The connection check: the smallest request that proves the key, the credit and the model all work. */
export const CHECK_SYSTEM = 'Reply with the single word OK.';
export const CHECK_USER = 'OK';
