// Tablet shots: every main screen at a landscape (1280×800) and a large portrait (800×1280) tablet window, plus
// Today at the default phone size to show phones are unchanged.
//   EXPO_OFFLINE=1 node scripts/preview/run.mjs --shots scripts/preview/tablet-shots.mjs --out <dir> [--dark]
// Names end in -land / -port / -phone.
import { ids } from './fixtures.mjs';

const KEY = 'sk-ant-api03-preview' + 'x'.repeat(60) + 'abcd';
const saveKey = [
  { click: { label: '먼저 키를 저장해 주세요' } },
  { fill: { label: 'Anthropic 키', value: KEY } },
  { click: { label: '저장' } },
  { wait: 300 },
  { click: { label: '뒤로' } },
];
const MEMO = '내일 오전 10시에 치과 전화. 금요일까지 분기 보고서 초안 마무리해야 함. 주말에 장보기 우유 계란 사과. 오늘 저녁 7시 반에 운동';

const screens = [
  { name: 'today', path: '/' },
  // Portrait only: in landscape the timeline is always beside the list and the segment is gone.
  { name: 'today-timeline', path: '/', only: 'port', steps: [{ click: { label: '타임라인' } }, { wait: 500 }] },
  { name: 'today-matrix', path: '/', steps: [{ click: { label: '매트릭스' } }, { wait: 500 }] },
  { name: 'lists', path: '/inbox' },
  { name: 'upcoming-week', path: '/upcoming' },
  { name: 'upcoming-month', path: '/upcoming', steps: [{ click: { text: '월' } }, { wait: 600 }] },
  { name: 'upcoming-year', path: '/upcoming', steps: [{ click: { text: '연' } }, { wait: 600 }] },
  { name: 'habits', path: '/habits' },
  { name: 'habit-overview', path: '/habit/overview' },
  { name: 'habit-overview-month', path: '/habit/overview', steps: [{ click: { label: '월간' } }, { wait: 600 }] },
  { name: 'habit-detail', path: '/habit/' + ids.detailHabit },
  { name: 'task-detail', path: '/task/' + ids.detailTask },
  { name: 'completed', path: '/completed' },
  { name: 'search', path: '/search' },
  { name: 'settings', path: '/settings' },
  { name: 'task-menu', path: '/inbox', steps: [{ hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }] },
  { name: 'schedule-sheet', path: '/inbox', steps: [
    { hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }, { click: { label: '날짜·시간' } }, { wait: 700 },
  ] },
  { name: 'quick-add', path: '/', steps: [
    { click: { label: '할 일 빠른 추가' } }, { fill: { label: '할 일 입력', value: '내일 저녁 7시 운동 #건강 p1' } }, { wait: 300 },
  ] },
  { name: 'focus', path: '/focus' },
  { name: 'ai-hub', path: '/assistant', steps: saveKey },
  { name: 'ai-organize-preview', path: '/assistant', steps: [
    ...saveKey, { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }, { click: { label: '정리하기' } }, { wait: 400 },
  ] },
];

const sizes = [
  { suffix: 'land', viewport: { width: 1280, height: 800 } },
  { suffix: 'port', viewport: { width: 800, height: 1280 } },
];

export default [
  ...sizes.flatMap(({ suffix, viewport }) => screens.filter((shot) => !shot.only || shot.only === suffix).map(({ only: _only, ...shot }) => ({
    ...shot, name: `${shot.name}-${suffix}`, viewport, deviceScaleFactor: 1.5,
  }))),
  // The harness's default phone (412×915, DPR 2): must match a shot taken before the tablet work.
  { name: 'today-phone', path: '/' },
  { name: 'quick-add-phone', path: '/', steps: [
    { click: { label: '할 일 빠른 추가' } }, { fill: { label: '할 일 입력', value: '내일 저녁 7시 운동 #건강 p1' } }, { wait: 300 },
  ] },
  { name: 'task-menu-phone', path: '/inbox', steps: [{ hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }] },
];
