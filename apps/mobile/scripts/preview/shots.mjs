// The screenshots run.mjs takes, in order. Each shot starts from a fresh browser context and a fresh
// fixture store, opens `path`, runs `steps` (optional) and captures <out>/<name>.png.
//
// Steps (run in order; a failing step fails the shot):
//   { click: { text: '오늘' } }        first element whose visible text contains the string
//   { click: { label: '할 일 빠른 추가' } } element with that accessibility label (aria-label on web)
//   { press: 'Escape' }               keyboard key, Playwright names (Enter, Escape, ArrowDown, ...)
//   { fill: { label: '할 일 입력', value: '내일 7시 운동' } }   text input by accessibility label (or placeholder)
//   { wait: 500 }                     milliseconds
//   { scroll: 600 }                   scroll the main scrollable view by px (negative = up)
//
// Prefer paths and accessibility labels over visible text: screens change often, labels less so.
import { ids } from './fixtures.mjs';

export default [
  { name: 'today', path: '/' },
  { name: 'inbox', path: '/inbox' },
  { name: 'upcoming', path: '/upcoming' },
  { name: 'habits', path: '/habits' },
  { name: 'focus', path: '/focus' },
  { name: 'settings', path: '/settings' },
  { name: 'habit-new', path: '/habit/new' },
  { name: 'routines', path: '/routines' },
  { name: 'search', path: '/search' },
  { name: 'completed', path: '/completed' },
  { name: 'task-detail', path: '/task/' + ids.detailTask },
  { name: 'habit-detail', path: '/habit/' + ids.detailHabit },
];
