// Shots of the AI 비서 screens: node scripts/preview/run.mjs --shots scripts/preview/ai-shots.mjs
//
// The web build keeps the key in memory only, so every shot that needs one saves it through the UI first
// (hub → key screen → 저장 → back) and then moves on by tapping, never by reloading. Requests to
// api.anthropic.com are answered by mock-anthropic.mjs; nothing reaches Anthropic.

const KEY = 'sk-ant-api03-preview' + 'x'.repeat(60) + 'abcd';
const WRONG_KEY = 'sk-ant-api03-wrong' + 'x'.repeat(60) + 'zzzz';

const saveKey = (key = KEY) => [
  { click: { label: '먼저 키를 저장해 주세요' } },
  { fill: { label: 'Anthropic 키', value: key } },
  { click: { label: '저장' } },
  { wait: 300 },
  { click: { label: '뒤로' } },
];

const MEMO = '내일 오전 10시에 치과 전화. 금요일까지 분기 보고서 초안 마무리해야 함 (매출 표 바꾸고 결론 요약). '
  + '주말에 장보기 우유 계란 사과. 오늘 저녁 7시 반에 운동 다시 시작! 엄마한테 안부 전화도 해야지';

export default [
  { name: 'ai-hub-no-key', path: '/assistant' },
  { name: 'ai-key-empty', path: '/ai-key' },
  { name: 'ai-key-saved', path: '/ai-key', steps: [{ fill: { label: 'Anthropic 키', value: KEY } }, { click: { label: '저장' } }, { wait: 300 }] },
  { name: 'ai-key-checked', path: '/ai-key', steps: [
    { fill: { label: 'Anthropic 키', value: KEY } }, { click: { label: '저장' } }, { wait: 300 }, { click: { label: '연결 확인' } }, { wait: 400 },
  ] },
  { name: 'ai-hub', path: '/assistant', steps: saveKey() },
  { name: 'ai-organize-need-key', path: '/assistant/organize' },
  { name: 'ai-organize-input', path: '/assistant', steps: [...saveKey(), { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }] },
  { name: 'ai-organize-preview', path: '/assistant', steps: [
    ...saveKey(), { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }, { click: { label: '정리하기' } }, { wait: 400 },
  ] },
  { name: 'ai-organize-edit', path: '/assistant', steps: [
    ...saveKey(), { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }, { click: { label: '정리하기' } }, { wait: 400 },
    { click: { label: '치과 예약 전화하기 고치기' } }, { wait: 500 },
  ] },
  { name: 'ai-plan-input', path: '/assistant', steps: [...saveKey(), { click: { label: '하루 계획' } }] },
  { name: 'ai-plan-preview', path: '/assistant', steps: [...saveKey(), { click: { label: '하루 계획' } }, { click: { label: '계획 세우기' } }, { wait: 400 }] },
  { name: 'ai-breakdown-pick', path: '/assistant', steps: [...saveKey(), { click: { label: '큰 일 쪼개기' } }] },
  { name: 'ai-breakdown-preview', path: '/assistant', steps: [
    ...saveKey(), { click: { label: '큰 일 쪼개기' } }, { click: { label: '분기 보고서 초안 제출 쪼개기' } }, { wait: 600 },
  ] },
  { name: 'ai-review-start', path: '/assistant', steps: [...saveKey(), { click: { label: '주간 돌아보기' } }] },
  { name: 'ai-review-result', path: '/assistant', steps: [...saveKey(), { click: { label: '주간 돌아보기' } }, { click: { label: '돌아보기 만들기' } }, { wait: 400 }] },
  { name: 'ai-review-result-bottom', path: '/assistant', steps: [
    ...saveKey(), { click: { label: '주간 돌아보기' } }, { click: { label: '돌아보기 만들기' } }, { wait: 400 }, { scroll: 900 },
  ] },
  // Reopening shows the saved review without a new request (the mock log for this shot lists one request).
  { name: 'ai-review-reopen', path: '/assistant', steps: [
    ...saveKey(), { click: { label: '주간 돌아보기' } }, { click: { label: '돌아보기 만들기' } }, { wait: 400 }, { click: { label: '뒤로' } },
    { click: { label: '주간 돌아보기' } }, { wait: 400 },
  ] },
  { name: 'ai-error-wrong-key', path: '/assistant', steps: [
    ...saveKey(WRONG_KEY), { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }, { click: { label: '정리하기' } }, { wait: 400 },
  ] },
];
