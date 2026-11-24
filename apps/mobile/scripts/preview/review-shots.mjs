// Extra shots for reviewing the screens added in the TickTick-inspired upgrade.
import { ids } from './fixtures.mjs';

export default [
  { name: 'today', path: '/' },
  { name: 'today-menu', path: '/', steps: [{ click: { label: '보기 옵션' } }, { wait: 500 }] },
  { name: 'upcoming-year', path: '/upcoming', steps: [{ click: { text: '연' } }, { wait: 600 }] },
  { name: 'habits', path: '/habits' },
  { name: 'habit-overview', path: '/habit/overview' },
  { name: 'habit-overview-month', path: '/habit/overview', steps: [{ click: { text: '월간' } }, { wait: 500 }] },
  { name: 'routines', path: '/routines' },
  { name: 'habit-new', path: '/habit/new' },
  { name: 'settings', path: '/settings' },
  { name: 'appearance', path: '/appearance' },
  { name: 'tab-bar', path: '/tab-bar' },
  { name: 'task-detail', path: '/task/' + ids.detailTask },
];
