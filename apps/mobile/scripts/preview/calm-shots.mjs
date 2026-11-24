// Shots for checking the colour budget in DESIGN.md: every main screen, to run light and with --dark.
//   EXPO_OFFLINE=1 node scripts/preview/run.mjs --shots scripts/preview/calm-shots.mjs --out <dir> [--dark]
import { ids } from './fixtures.mjs';

const todayTitles = [
  '분기 보고서 초안 제출', '치과 예약 전화하기', '팀 스탠드업', '디자인 리뷰 피드백 정리', '우유랑 계란 사기', '저녁 운동 30분',
  '메일함 정리하고 답장하기',
];
const completeAll = todayTitles.flatMap((title) => [{ click: { label: title + ' 완료' } }, { wait: 250 }]);

const KEY = 'sk-ant-api03-preview' + 'x'.repeat(60) + 'abcd';
const saveKey = [
  { click: { label: '먼저 키를 저장해 주세요' } },
  { fill: { label: 'Anthropic 키', value: KEY } },
  { click: { label: '저장' } },
  { wait: 300 },
  { click: { label: '뒤로' } },
];
const MEMO = '내일 오전 10시에 치과 전화. 금요일까지 분기 보고서 초안 마무리해야 함. 주말에 장보기 우유 계란 사과. 오늘 저녁 7시 반에 운동';

// Device-only looks a real user would have set: a colour and icon per list, an emoji and colour per habit. They show
// that list and habit colours stay out of Today and the habit grids.
const storage = {
  'dayframe-project-meta-v1': JSON.stringify({
    [ids.project.work]: { color: '#3574F0', icon: 'briefcase' },
    [ids.project.personal]: { color: '#DC4C3E', icon: 'home' },
    [ids.project.health]: { color: '#1F9D63', icon: 'heart' },
  }),
  'dayframe-habit-meta-v1': JSON.stringify({
    [ids.detailHabit]: { emoji: '💧', color: '#3574F0', timeOfDay: 'morning' },
    '00000000-0000-4000-8005-000000000002': { emoji: '🧘', color: '#7C5CFF' },
    '00000000-0000-4000-8005-000000000003': { emoji: '📚', color: '#E5870B' },
    '00000000-0000-4000-8005-000000000005': { emoji: '💪', color: '#DC4C3E' },
  }),
};

const shots = [
  { name: 'today', path: '/' },
  { name: 'today-bottom', path: '/', steps: [{ scroll: 900 }, { wait: 300 }] },
  { name: 'today-all-done', path: '/', steps: [...completeAll, { wait: 4500 }] },
  { name: 'today-timeline', path: '/', steps: [{ click: { label: '타임라인' } }, { wait: 500 }] },
  { name: 'today-matrix', path: '/', steps: [{ click: { label: '매트릭스' } }, { wait: 500 }] },
  { name: 'plan-day', path: '/', steps: [{ click: { label: '하루 계획·일정 정리' } }, { wait: 500 }] },
  { name: 'quick-add', path: '/', steps: [
    { click: { label: '할 일 빠른 추가' } }, { fill: { label: '할 일 입력', value: '내일 저녁 7시 운동 #건강 p1' } }, { wait: 300 },
  ] },
  { name: 'lists', path: '/inbox' },
  { name: 'upcoming-week', path: '/upcoming' },
  { name: 'upcoming-month', path: '/upcoming', steps: [{ click: { text: '월' } }, { wait: 600 }] },
  { name: 'upcoming-year', path: '/upcoming', steps: [{ click: { text: '연' } }, { wait: 600 }] },
  { name: 'habits', path: '/habits' },
  { name: 'habit-overview', path: '/habit/overview' },
  { name: 'habit-detail', path: '/habit/' + ids.detailHabit },
  { name: 'habit-new', path: '/habit/new' },
  { name: 'task-detail', path: '/task/' + ids.detailTask },
  { name: 'task-menu', path: '/inbox', steps: [{ hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }] },
  { name: 'completed', path: '/completed' },
  { name: 'focus', path: '/focus' },
  { name: 'settings', path: '/settings' },
  { name: 'appearance', path: '/appearance' },
  { name: 'ai-hub', path: '/assistant', steps: saveKey },
  { name: 'ai-organize-preview', path: '/assistant', steps: [
    ...saveKey, { click: { label: '메모 정리' } }, { fill: { label: '메모', value: MEMO } }, { click: { label: '정리하기' } }, { wait: 400 },
  ] },
  { name: 'ai-plan-preview', path: '/assistant', steps: [...saveKey, { click: { label: '하루 계획' } }, { click: { label: '계획 세우기' } }, { wait: 400 }] },
  { name: 'ai-review-result', path: '/assistant', steps: [
    ...saveKey, { click: { label: '주간 돌아보기' } }, { click: { label: '돌아보기 만들기' } }, { wait: 400 },
  ] },
  { name: 'ai-key', path: '/ai-key', steps: [
    { fill: { label: 'Anthropic 키', value: KEY } }, { click: { label: '저장' } }, { wait: 300 }, { click: { label: '연결 확인' } }, { wait: 400 },
  ] },
];

export default shots.map((shot) => ({ ...shot, storage }));
