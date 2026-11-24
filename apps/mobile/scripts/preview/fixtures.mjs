// Sample account data for the preview harness, generated relative to "now" in Asia/Seoul so that
// "overdue", "today" and "this week" always mean what they say. Shapes follow packages/shared/types.ts.
//
// Every id is a fixed UUID so shots.mjs can link to a specific task or habit (see `ids` below).
import { Buffer } from 'node:buffer';

import { Temporal } from '@js-temporal/polyfill';

export const TIME_ZONE = 'Asia/Seoul';
export const USER_ID = '00000000-0000-4000-8000-0000000000aa';
export const USER_EMAIL = 'preview@dayframe.invalid';

/** Deterministic UUID from a group number and an index, e.g. uid(3, 7) = 00000000-0000-4000-8003-000000000007. */
const uid = (group, index) => `00000000-0000-4000-80${String(group).padStart(2, '0')}-${String(index).padStart(12, '0')}`;

/** Ids that shots (and humans) may want to reference. */
export const ids = {
  user: USER_ID,
  project: { work: uid(1, 1), personal: uid(1, 2), health: uid(1, 3) },
  section: { thisWeek: uid(2, 1), backlog: uid(2, 2) },
  tag: { focus: uid(3, 1), call: uid(3, 2), errand: uid(3, 3), reading: uid(3, 4) },
  /** A task with notes, a tag, subtasks and a time: the default task-detail shot. */
  detailTask: uid(4, 4),
  /** A daily habit with a multi-count target: the default habit-detail shot. */
  detailHabit: uid(5, 1),
};

/** Small seeded PRNG so habit logs look random but are the same on every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a fresh store. Called once per shot, so a shot's taps never leak into the next one. */
export function createFixtures(now = Temporal.Now.instant()) {
  const zdt = now.toZonedDateTimeISO(TIME_ZONE);
  const today = zdt.toPlainDate();
  const iso = (instant) => instant.toString();
  /** Instant at `minutes` past local midnight `days` from today (null minutes = start of day, for all-day tasks). */
  const at = (days, minutes = null) => {
    const date = today.add({ days });
    const time = minutes === null ? undefined : Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
    return iso(date.toZonedDateTime({ timeZone: TIME_ZONE, plainTime: time }).toInstant());
  };
  const ago = (minutes) => iso(now.subtract({ minutes }));
  // `minutes` ago, but never before today's local midnight, so "done today" stays today even just after midnight.
  const startOfToday = today.toZonedDateTime({ timeZone: TIME_ZONE }).toInstant();
  const todayAgo = (minutes) => {
    const at = now.subtract({ minutes });
    return iso(Temporal.Instant.compare(at, startOfToday) < 0 ? startOfToday.add({ milliseconds: Math.floor((now.epochMilliseconds - startOfToday.epochMilliseconds) * (minutes % 7 + 1) / 8) }) : at);
  };
  const created = ago(60 * 24 * 40);

  const me = { id: USER_ID, display_name: '지민', timezone: TIME_ZONE, new_task_date: 'today', created_at: iso(now.subtract({ hours: 24 * 120 })) };

  const owned = (id, extra) => ({ id, user_id: USER_ID, created_at: created, ...extra });
  const projects = [
    owned(ids.project.work, { name: '업무', position: 0 }),
    owned(ids.project.personal, { name: '개인', position: 1 }),
    owned(ids.project.health, { name: '건강', position: 2 }),
  ];
  const sections = [
    owned(ids.section.thisWeek, { name: '이번 주', position: 0, project_id: ids.project.work }),
    owned(ids.section.backlog, { name: '백로그', position: 1, project_id: ids.project.work }),
  ];
  const tags = [
    owned(ids.tag.focus, { name: '집중' }),
    owned(ids.tag.call, { name: '전화' }),
    owned(ids.tag.errand, { name: '외출' }),
    owned(ids.tag.reading, { name: '읽을거리' }),
  ];

  // Days until the end of this month, for the "last day of month" repeat.
  const monthEnd = today.with({ day: today.daysInMonth }).since(today).days;
  // A day later this week (but not today) when possible, otherwise next Monday.
  const laterThisWeek = Math.min(7 - today.dayOfWeek, 3) || 1;

  let taskIndex = 0;
  const task = (extra) => {
    taskIndex += 1;
    const id = extra.id ?? uid(4, taskIndex);
    return {
      id, user_id: USER_ID, created_at: created, updated_at: created,
      project_id: null, section_id: null, parent_task_id: null, title: '', notes: null, priority: 4,
      position: taskIndex, due_at: null, all_day: false, timezone: TIME_ZONE, recurrence_rule: null,
      recurrence_mode: 'schedule', recurrence_anchor_at: null, recurrence_local_time: null, occurrence_at: null,
      duration_minutes: null, completed_at: null,
      ...extra,
      ...(extra.recurrence_rule && !extra.recurrence_anchor_at ? { recurrence_anchor_at: extra.due_at } : {}),
    };
  };
  const work = { project_id: ids.project.work };
  const personal = { project_id: ids.project.personal };
  const health = { project_id: ids.project.health };

  const tasks = [
    // 1-2: overdue
    task({ title: '분기 보고서 초안 제출', ...work, section_id: ids.section.thisWeek, priority: 1, due_at: at(-2), all_day: true,
      notes: '매출 표는 재무팀 최신본으로 교체. 결론 요약은 한 페이지 이내.' }),
    task({ title: '치과 예약 전화하기', ...personal, priority: 2, due_at: at(-1, 10 * 60) }),
    // 3-8: today
    task({ title: '팀 스탠드업', ...work, section_id: ids.section.thisWeek, priority: 3, due_at: at(0, 9 * 60 + 30), duration_minutes: 15,
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', recurrence_local_time: '09:30' }),
    task({ title: '디자인 리뷰 피드백 정리', ...work, section_id: ids.section.thisWeek, priority: 2, due_at: at(0, 14 * 60), duration_minutes: 60,
      notes: '피그마 코멘트 기준으로 정리하고, 결정이 필요한 항목은 따로 표시하기.\nhttps://example.com/design-review' }),
    task({ title: '우유랑 계란 사기', ...personal, priority: 4, due_at: at(0), all_day: true }),
    task({ title: '저녁 운동 30분', ...health, priority: 3, due_at: at(0, 19 * 60), duration_minutes: 30,
      recurrence_rule: 'FREQ=DAILY', recurrence_local_time: '19:00' }),
    task({ title: '비타민 챙겨 먹기', ...health, priority: 4, due_at: at(1), all_day: true, recurrence_rule: 'FREQ=DAILY' }),
    task({ title: '메일함 정리하고 답장하기', priority: 3, due_at: at(0), all_day: true }),
    // 9-13: later this week / month
    task({ title: '블로그 글 초안 쓰기', ...personal, priority: 3, due_at: at(1, 10 * 60),
      notes: '주제: 작은 습관이 쌓이는 방식. 개요 → 사례 2개 → 마무리.' }),
    task({ title: '주간 회고 작성', ...work, section_id: ids.section.thisWeek, priority: 2, due_at: at(laterThisWeek), all_day: true,
      recurrence_rule: 'FREQ=WEEKLY' }),
    task({ title: '엄마 생신 선물 고르기', ...personal, priority: 1, due_at: at(5), all_day: true }),
    task({ title: '자동차 보험 갱신', ...personal, priority: 2, due_at: at(12, 11 * 60) }),
    task({ title: '월세 이체', ...personal, priority: 1, due_at: at(monthEnd || 0), all_day: true,
      recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=-1' }),
    // 14-18: undated
    task({ title: '책 「프로젝트 헤일메리」 읽기', priority: 4 }),
    task({ title: '이사 업체 견적 비교', ...personal, priority: 3, notes: '세 곳 이상 비교. 포장이사 / 반포장 가격 모두 받기.' }),
    task({ title: 'API 문서 업데이트', ...work, section_id: ids.section.backlog, priority: 4 }),
    task({ title: '분리수거', priority: 4, due_at: at(2, 21 * 60), recurrence_rule: 'FREQ=WEEKLY;BYDAY=' + ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][today.add({ days: 2 }).dayOfWeek - 1],
      recurrence_mode: 'completion', recurrence_local_time: '21:00' }),
    task({ title: '휴대폰 사진 백업', priority: 4 }),
    // 19-21: completed (two today, one earlier this week)
    task({ title: '회의실 예약', ...work, priority: 3, due_at: at(0), all_day: true, completed_at: todayAgo(90), updated_at: todayAgo(90) }),
    task({ title: '택배 반품 신청', ...personal, priority: 4, completed_at: todayAgo(35), updated_at: todayAgo(35) }),
    task({ title: '세탁소 맡긴 옷 찾기', ...personal, priority: 4, due_at: at(-3), all_day: true,
      completed_at: at(-3, 18 * 60), updated_at: at(-3, 18 * 60) }),
  ];
  const byTitle = (title) => tasks.find((t) => t.title === title);

  // Subtasks: subtasks of the detail task (one done), and of the moving-company task.
  const sub = (parent, title, extra = {}) => task({ title, parent_task_id: parent.id, project_id: null, section_id: null,
    timezone: TIME_ZONE, ...extra });
  const detail = byTitle('디자인 리뷰 피드백 정리');
  const moving = byTitle('이사 업체 견적 비교');
  tasks.push(
    sub(detail, '피그마 코멘트 모으기', { completed_at: todayAgo(120), updated_at: todayAgo(120) }),
    sub(detail, '우선순위 붙이기'),
    sub(detail, '결정 필요한 항목 공유'),
    sub(moving, '견적 요청 3곳'),
    sub(moving, '방문 견적 일정 잡기'),
  );
  // The detail task must keep the id the default shot links to.
  if (detail.id !== ids.detailTask) throw new Error('fixtures: detail task id drifted; update ids.detailTask');

  const taskTags = [
    [byTitle('분기 보고서 초안 제출'), ids.tag.focus],
    [byTitle('치과 예약 전화하기'), ids.tag.call],
    [detail, ids.tag.focus],
    [byTitle('우유랑 계란 사기'), ids.tag.errand],
    [byTitle('블로그 글 초안 쓰기'), ids.tag.focus],
    [byTitle('엄마 생신 선물 고르기'), ids.tag.errand],
    [byTitle('자동차 보험 갱신'), ids.tag.call],
    [byTitle('책 「프로젝트 헤일메리」 읽기'), ids.tag.reading],
  ].map(([t, tagId]) => ({ user_id: USER_ID, task_id: t.id, tag_id: tagId }));

  // Check-offs: the completed tasks above, plus repeating occurrences done today and yesterday.
  const completions = [];
  for (const t of tasks) {
    if (t.completed_at && !t.parent_task_id) completions.push({ task: t, completed_at: t.completed_at, occurrence_due_at: t.due_at });
  }
  const vitamin = byTitle('비타민 챙겨 먹기');
  completions.push({ task: { ...vitamin }, completed_at: todayAgo(200), occurrence_due_at: at(0) });
  const standup = byTitle('팀 스탠드업');
  completions.push({ task: { ...standup }, completed_at: at(-1, 9 * 60 + 50), occurrence_due_at: at(-1, 9 * 60 + 30) });

  // Habits: start ~75 days ago, logs over the last ~70 days.
  const habitDefs = [
    { id: ids.detailHabit, name: '물 8잔 마시기', cadence: 'daily', target_count: 8, rate: 0.8 },
    { id: uid(5, 2), name: '아침 스트레칭', cadence: 'daily', target_count: 1, rate: 0.85 },
    { id: uid(5, 3), name: '독서 20분', cadence: 'daily', target_count: 1, rate: 0.65 },
    { id: uid(5, 4), name: '명상 10분', cadence: 'daily', target_count: 1, rate: 0.5 },
    { id: uid(5, 5), name: '헬스장 가기', cadence: 'weekly', target_count: 3, rate: 0.45 },
    { id: uid(5, 6), name: '영어 단어 외우기', cadence: 'weekly', target_count: 5, rate: 0.7 },
  ];
  const habits = habitDefs.map((h, i) => ({
    id: h.id, user_id: USER_ID, created_at: iso(now.subtract({ hours: 24 * 75 - i })), name: h.name, cadence: h.cadence,
    target_count: h.target_count, timezone: TIME_ZONE, start_date: today.subtract({ days: 75 }).toString(), archived_at: null,
  }));
  const habitLogs = [];
  habitDefs.forEach((h, i) => {
    const random = rng(1000 + i);
    for (let d = 70; d >= 0; d -= 1) {
      const date = today.subtract({ days: d });
      const roll = random();
      // Today: leave some undone so the screen shows a mix of done and open.
      if (d === 0 && i % 2 === 1) continue;
      let status = null;
      let count = 0;
      if (roll < h.rate) {
        status = 'completed';
        count = h.target_count > 1 && h.cadence === 'daily' ? (random() < 0.75 ? h.target_count : 3 + Math.floor(random() * 4)) : 1;
        if (d === 0 && h.target_count > 1) count = 5;
      } else if (roll < h.rate + 0.04) {
        status = 'skipped';
      } else if (roll < h.rate + 0.06 && h.cadence === 'daily') {
        status = 'frozen';
      }
      if (status) habitLogs.push({ user_id: USER_ID, habit_id: h.id, log_date: date.toString(), status, count, created_at: iso(date.toZonedDateTime({ timeZone: TIME_ZONE, plainTime: '21:00' }).toInstant()) });
    }
  });

  // Focus sessions over the last 7 days (so "this week" and "today" have data at any hour), newest first.
  // [days ago, local start minutes, length, status, task]; today's two are placed just before "now" instead.
  const focusSessions = [];
  const report = byTitle('분기 보고서 초안 제출').id;
  const focusPlan = [
    [0, null, 25, 'completed', detail.id], [0, null, 50, 'completed', report],
    [1, 10 * 60, 50, 'completed', report], [1, 13 * 60, 25, 'cancelled', null], [1, 15 * 60, 25, 'completed', detail.id],
    [2, 14 * 60, 50, 'completed', byTitle('블로그 글 초안 쓰기').id], [3, 20 * 60, 25, 'completed', null],
    [4, 9 * 60, 50, 'completed', report], [5, 16 * 60, 25, 'completed', null], [6, 11 * 60, 50, 'completed', detail.id],
    [9, 10 * 60, 25, 'completed', null],
  ];
  let todayCursor = now.subtract({ minutes: 20 });
  focusPlan.forEach(([daysAgo, minutes, length, status, taskId], i) => {
    let start;
    if (minutes === null) {
      start = todayCursor.subtract({ minutes: length });
      todayCursor = start.subtract({ minutes: 15 });
    } else {
      start = today.subtract({ days: daysAgo }).toZonedDateTime({ timeZone: TIME_ZONE, plainTime: Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 }) }).toInstant();
    }
    const end = status === 'cancelled' ? start.add({ minutes: Math.round(length / 3) }) : start.add({ minutes: length });
    focusSessions.push({ id: uid(6, i + 1), user_id: USER_ID, created_at: iso(start), task_id: taskId, habit_id: null,
      started_at: iso(start), ended_at: iso(end), planned_seconds: length * 60, status });
  });
  focusSessions.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  const mcpConnections = [
    { id: uid(7, 1), label: 'Claude Desktop', created_at: ago(60 * 24 * 21), last_used_at: ago(60 * 5) },
    { id: uid(7, 2), label: '노트북 Claude Code', created_at: ago(60 * 24 * 3), last_used_at: null },
  ];

  const appVersion = {
    latestVersion: process.env.APP_VERSION ?? '1.0.0', versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    minSupportedVersion: '1.0.0', releaseNotes: '미리보기용 릴리스 노트',
    apkDownloadUrl: 'https://github.com/ggumtak/dayframe/releases/download/v1.0.0/dayframe.apk', iosStoreOrTestFlightUrl: null,
  };

  return { me, projects, sections, tags, tasks, taskTags, completions, habits, habitLogs, focusSessions, mcpConnections, appVersion };
}

/** A fake Supabase Auth session in the shape @supabase/auth-js stores (see src/lib/auth.ts, AUTH_STORAGE_KEY). */
export function fakeSession(nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresIn = 60 * 60 * 24 * 365;
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: USER_ID, email: USER_EMAIL, role: 'authenticated', aud: 'authenticated', iat: nowSeconds, exp: nowSeconds + expiresIn }),
    'preview-signature',
  ].join('.');
  const user = {
    id: USER_ID, aud: 'authenticated', role: 'authenticated', email: USER_EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z',
    phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_anonymous: false,
  };
  return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, expires_at: nowSeconds + expiresIn,
    refresh_token: 'preview-refresh-token', user };
}
