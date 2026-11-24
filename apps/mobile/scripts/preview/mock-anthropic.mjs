// Stand-in for `POST https://api.anthropic.com/v1/messages` in preview shots, so the AI 비서 screens can be
// captured without a key or network. Nothing here talks to Anthropic: run.mjs routes the request here.
//
// Replies are canned but built from what the app sent (the task ids, window and facts in the user message),
// so they look like answers to the fixture data. The request itself is checked against the rules of the
// models the app uses (no sampling parameters, no forced tool choice, no budget_tokens, structured output
// with an effort level, the fallback beta for Opus/Sonnet); a request that breaks one gets the 400 the real
// API would send, which makes the shot fail visibly.
//
// Keys: a key containing "wrong" is answered 401, one containing "nocredit" 400 with the low-balance
// message, one containing "busy" 529, and one containing "nofallback" refuses `fallbacks` with a 400
// invalid_request_error (to show the client retrying without it). Anything else is accepted.

export const isAnthropicMessages = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'api.anthropic.com' && parsed.pathname === '/v1/messages';
  } catch {
    return false;
  }
};

const error = (status, type, message) => ({ status, json: { type: 'error', error: { type, message }, request_id: 'req_preview' } });

/** "지금: 2026-11-24 화요일 14:07 (...)" → { date, minutes }. */
function readNow(text) {
  const match = /지금: (\d{4}-\d{2}-\d{2}) \S+ (\d{2}):(\d{2})/.exec(text);
  if (!match) return { date: new Date().toISOString().slice(0, 10), minutes: 12 * 60 };
  return { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) };
}

const addDays = (iso, days) => {
  const date = new Date(iso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
const hhmm = (minutes) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
/** 이/가, 을/를, 는/은 after a Hangul word (enough for the fixture titles). */
const josa = (word, withFinal, withoutFinal) => {
  const code = word.trim().charCodeAt(word.trim().length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? withFinal : withoutFinal;
};
const toMinutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));

function organize(user) {
  const { date } = readNow(user);
  const lists = /<lists>(.*)<\/lists>/.exec(user)?.[1]?.split(', ') ?? [];
  const list = (name) => (lists.includes(name) ? name : null);
  const friday = addDays(date, ((4 - weekday(date)) + 7) % 7 || 7);
  const saturday = addDays(date, ((5 - weekday(date)) + 7) % 7 || 7);
  return {
    tasks: [
      { title: '치과 예약 전화하기', date: addDays(date, 1), time: '10:00', list: list('개인'), priority: 2, duration_minutes: 10, subtasks: [] },
      { title: '분기 보고서 초안 마무리', date: friday, time: null, list: list('업무'), priority: 1, duration_minutes: 120,
        subtasks: ['매출 표 최신본으로 교체', '결론 요약 한 페이지로 쓰기'] },
      { title: '장보기', date: saturday, time: null, list: list('개인'), priority: 4, duration_minutes: null, subtasks: ['우유', '계란', '사과'] },
      { title: '저녁 운동', date, time: '19:30', list: list('건강'), priority: 3, duration_minutes: 30, subtasks: [] },
      { title: '엄마한테 안부 전화', date: null, time: null, list: list('개인'), priority: 4, duration_minutes: null, subtasks: [] },
    ],
  };
}

function plan(user) {
  const window = /<window>(\d{2}:\d{2})–(\d{2}:\d{2})<\/window>/.exec(user);
  const start = window ? toMinutes(window[1]) : 9 * 60;
  const end = window ? toMinutes(window[2]) : 22 * 60;
  const rows = (/<tasks>\n([\s\S]*?)\n<\/tasks>/.exec(user)?.[1] ?? '').split('\n').filter(Boolean).map((row) => {
    const field = (name) => new RegExp(`(?:^| \\| )${name}=([^|]*?)(?: \\||$)`).exec(row)?.[1]?.trim() ?? null;
    return { id: field('id'), title: field('title'), priority: Number(field('priority') ?? 4), fixed: field('fixed'), duration: Number(field('duration') ?? 0) || null };
  });
  const fixed = rows.filter((row) => row.fixed).map((row) => ({ start: toMinutes(row.fixed), minutes: row.duration ?? 30, id: row.id }));
  const blocks = fixed.map((block) => ({ task_id: block.id, start: hhmm(block.start), minutes: block.minutes }));
  const left = [];
  let cursor = start;
  const flexible = rows.filter((row) => !row.fixed).sort((a, b) => a.priority - b.priority);
  for (const row of flexible) {
    const minutes = row.duration ?? (/보고서|정리|글/.test(row.title ?? '') ? 60 : /전화|사기|메일/.test(row.title ?? '') ? 20 : 30);
    // Step past any fixed block this one would run into.
    for (const block of fixed) if (cursor < block.start + block.minutes && block.start < cursor + minutes) cursor = block.start + block.minutes + 10;
    if (cursor + minutes > end || blocks.length >= 6) {
      left.push({ task_id: row.id, reason: row.priority >= 4 ? '내일로 미루는 편이 낫습니다' : '오늘 남은 시간이 부족합니다' });
      continue;
    }
    blocks.push({ task_id: row.id, start: hhmm(cursor), minutes });
    cursor += minutes + (minutes >= 60 ? 15 : 10);
  }
  const first = flexible.find((row) => blocks.some((block) => block.task_id === row.id));
  return {
    blocks, left_out: left,
    note: first ? `가장 급한 ‘${first.title}’부터 시작하고, 정해 둔 일정 사이사이에 짧은 일을 넣었습니다.` : '정해 둔 일정에 맞춰 하루를 배치했습니다.',
  };
}

function breakdown(user) {
  const title = /<task>(.*)<\/task>/.exec(user)?.[1] ?? '';
  if (/보고서/.test(title)) {
    return {
      steps: [
        { title: '재무팀에 최신 매출 표 요청하기', minutes: 10 },
        { title: '매출 표 교체하고 수치 맞추기', minutes: 30 },
        { title: '본문 초안 쓰기', minutes: 60 },
        { title: '결론 요약 한 페이지로 줄이기', minutes: 30 },
        { title: '숫자와 맞춤법 마지막 확인', minutes: 15 },
      ],
    };
  }
  return {
    steps: [
      { title: '해야 할 범위 적어 보기', minutes: 10 },
      { title: '필요한 자료 모으기', minutes: 20 },
      { title: '첫 단계 30분만 하기', minutes: 30 },
      { title: '남은 일 다시 나누기', minutes: 10 },
    ],
  };
}

function review(user) {
  const completed = (/<completed>\n([\s\S]*?)\n<\/completed>/.exec(user)?.[1] ?? '').split('\n').filter((line) => line.startsWith('- '));
  const overdue = (/<still_overdue>\n([\s\S]*?)\n<\/still_overdue>/.exec(user)?.[1] ?? '').split('\n').filter((line) => line.startsWith('- '));
  const habits = (/<habits[^>]*>\n([\s\S]*?)\n<\/habits>/.exec(user)?.[1] ?? '').split('\n').filter((line) => line.startsWith('- ')).map((line) => ({
    name: /^- (.*?):/.exec(line)?.[1] ?? '', done: Number(/(?:완료|기록) (\d+)/.exec(line)?.[1] ?? 0),
  }));
  const focus = (/<focus>(.*)<\/focus>/.exec(user)?.[1] ?? '').split(', ').map((entry) => Number(/(\d+)분/.exec(entry)?.[1] ?? 0));
  const focusTotal = focus.reduce((a, b) => a + b, 0);
  const activeDays = focus.filter((minutes) => minutes > 0).length;
  const best = habits.slice().sort((a, b) => b.done - a.done)[0];
  const worst = habits.slice().sort((a, b) => a.done - b.done)[0];
  const overdueTitle = /^- (.*?) \(마감/.exec(overdue[0] ?? '')?.[1];
  return {
    headline: `집중은 ${activeDays}일 동안 ${Math.round(focusTotal / 60 * 10) / 10}시간으로 꾸준했지만, ${overdueTitle ? `‘${overdueTitle}’${josa(overdueTitle, '이', '가')} 아직 남아 있습니다` : '지연된 할 일은 없습니다'}.`,
    wins: [
      `할 일 ${completed.length}개를 끝냈습니다.`,
      best ? `‘${best.name}’${josa(best.name, '을', '를')} 7일 중 ${best.done}일 지켰습니다.` : null,
      `집중 기록이 ${activeDays}일 있었고, 하루 평균 ${Math.round(focusTotal / Math.max(activeDays, 1))}분입니다.`,
    ].filter(Boolean),
    slipped: [
      overdueTitle ? `‘${overdueTitle}’${josa(overdueTitle, '은', '는')} 마감이 지난 채 남아 있습니다.` : null,
      worst && worst !== best ? `‘${worst.name}’${josa(worst.name, '은', '는')} 이번 주 ${worst.done}번에 그쳤습니다.` : null,
    ].filter(Boolean),
    patterns: ['집중은 오전 10시 전후에 가장 길게 이어졌습니다.', '업무 목록의 일은 주 초반에, 개인 일은 주말에 몰렸습니다.'],
    suggestions: [
      { title: overdueTitle ? `${overdueTitle} 30분만 먼저 하기` : '다음 주 가장 중요한 일 하나 정하기', as_task: true },
      { title: worst ? `${worst.name} 시간을 아침으로 옮겨 보기` : '습관 하나만 골라 집중하기', as_task: false },
      { title: '금요일 오후에 다음 주 일정 훑어보기', as_task: true },
    ],
  };
}

/** Validates the request the way the API would, then answers it. `headers` are lower-cased. */
export function handleAnthropic(method, headers, body, log) {
  if (method !== 'POST') return error(405, 'invalid_request_error', 'Method not allowed');
  // SDK 1.x sends the key as `Authorization: Bearer`; older clients use x-api-key. Accept either.
  const key = headers['x-api-key'] ?? (headers.authorization ?? '').replace(/^Bearer /i, '');
  const model = body?.model;
  const betas = (headers['anthropic-beta'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  log?.push({ model, effort: body?.output_config?.effort, format: !!body?.output_config?.format, max_tokens: body?.max_tokens,
    betas, fallbacks: body?.fallbacks ?? null, keys: Object.keys(body ?? {}).sort().join(','), auth: headers['x-api-key'] ? 'x-api-key' : headers.authorization ? 'bearer' : 'none' });

  if (!key) return error(401, 'authentication_error', 'missing API key');
  if (key.includes('wrong')) return error(401, 'authentication_error', 'invalid x-api-key');
  if (key.includes('nocredit')) return error(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.');
  if (key.includes('busy')) return error(529, 'overloaded_error', 'Overloaded');
  if (key.includes('nofallback') && body?.fallbacks !== undefined) {
    return error(400, 'invalid_request_error', `Unexpected value(s) \`${betas.join(',')}\` for the \`anthropic-beta\` header.`);
  }
  if (!['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].includes(model)) return error(404, 'not_found_error', 'model: ' + model);
  for (const banned of ['temperature', 'top_p', 'top_k']) if (banned in body) return error(400, 'invalid_request_error', banned + ' is not supported');
  if (body.tool_choice && ['any', 'tool'].includes(body.tool_choice.type)) return error(400, 'invalid_request_error', 'tool_choice: type "tool" and "any" are not supported for this model.');
  if (body.thinking && body.thinking.type !== 'adaptive') return error(400, 'invalid_request_error', 'thinking.type must be adaptive');
  if (body.messages?.at(-1)?.role !== 'user') return error(400, 'invalid_request_error', 'prefill is not supported');
  if (body.fallbacks !== undefined) {
    if (model === 'claude-haiku-5-5') return error(400, 'invalid_request_error', 'fallbacks: not supported for this model');
    if (!betas.includes('server-side-fallback-2026-07-01')) return error(400, 'invalid_request_error', 'fallbacks: Extra inputs are not permitted');
  }

  const user = typeof body.messages[0].content === 'string' ? body.messages[0].content
    : body.messages[0].content.map((block) => block.text ?? '').join('');
  const properties = body.output_config?.format?.schema?.properties ?? {};
  let reply;
  if ('tasks' in properties) reply = organize(user);
  else if ('blocks' in properties) reply = plan(user);
  else if ('steps' in properties) reply = breakdown(user);
  else if ('headline' in properties) reply = review(user);
  else reply = null; // the connection check: plain text

  const text = reply ? JSON.stringify(reply) : 'OK';
  const input = Math.round((JSON.stringify(body.system ?? '').length + user.length) / 1.6) + 12;
  return {
    status: 200,
    json: {
      id: 'msg_preview_' + Math.random().toString(36).slice(2, 10), type: 'message', role: 'assistant', model,
      content: [{ type: 'thinking', thinking: '', signature: 'preview' }, { type: 'text', text }],
      stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
      usage: { input_tokens: input, output_tokens: Math.round(text.length / 1.4) + 380, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}
