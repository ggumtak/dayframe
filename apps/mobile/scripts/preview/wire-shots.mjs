// Shots for reviewing the artwork wired into the screens (empty states, all-done card, Today backdrop) and the
// fixes that came with it (year legend, habit looks, priority words, habit start date, completed subtasks).
//   node scripts/preview/run.mjs --shots scripts/preview/wire-shots.mjs --out <dir> [--dark]
import { ids } from './fixtures.mjs';

/** A small phone, to check that empty states and the long-press menu fit 360dp. */
const SMALL = { width: 360, height: 760 };

// Every task the fixtures put on today or before, so ticking them all reaches the all-done card.
const todayTitles = [
  '분기 보고서 초안 제출', '치과 예약 전화하기', '팀 스탠드업', '디자인 리뷰 피드백 정리', '우유랑 계란 사기', '저녁 운동 30분',
  '메일함 정리하고 답장하기',
];
const completeAll = todayTitles.flatMap((title) => [{ click: { label: title + ' 완료' } }, { wait: 250 }]);

const newEmptyList = [
  { click: { label: '새 목록 만들기' } },
  { wait: 400 },
  { fill: { label: '목록 이름', value: '여행 준비' } },
  { press: 'Enter' },
  { wait: 4500 }, // the toast fades
];

export default [
  { name: 'today', path: '/' },
  { name: 'today-small', path: '/', viewport: SMALL },
  { name: 'today-timeline', path: '/', steps: [{ click: { label: '타임라인' } }, { wait: 500 }] },
  { name: 'today-all-done', path: '/', steps: [...completeAll, { wait: 4500 }] },
  { name: 'today-all-done-small', path: '/', viewport: SMALL, steps: [...completeAll, { wait: 4500 }] },
  { name: 'list-empty', path: '/inbox', steps: newEmptyList },
  { name: 'list-empty-small', path: '/inbox', viewport: SMALL, steps: newEmptyList },
  { name: 'search-none', path: '/search', steps: [{ fill: { label: '검색어', value: '스카이다이빙' } }, { wait: 500 }] },
  { name: 'search-none-small', path: '/search', viewport: SMALL, steps: [{ fill: { label: '검색어', value: '스카이다이빙' } }, { wait: 500 }] },
  { name: 'upcoming-year', path: '/upcoming', steps: [{ click: { text: '연' } }, { wait: 600 }, { scroll: 2000 }, { wait: 300 }] },
  { name: 'upcoming-year-top', path: '/upcoming', steps: [{ click: { text: '연' } }, { wait: 600 }] },
  { name: 'habits', path: '/habits' },
  { name: 'habit-overview', path: '/habit/overview' },
  { name: 'habit-detail', path: '/habit/' + ids.detailHabit },
  { name: 'task-detail', path: '/task/' + ids.detailTask },
  { name: 'task-menu', path: '/inbox', steps: [{ hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }] },
  { name: 'task-menu-small', path: '/inbox', viewport: SMALL, steps: [{ hold: { text: '휴대폰 사진 백업' } }, { wait: 600 }] },
  { name: 'completed', path: '/completed' },
];
