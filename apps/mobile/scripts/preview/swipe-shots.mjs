// Task-row swipe states and tab changes, to check that a row's swipe actions only show on the side being revealed.
//   EXPO_OFFLINE=1 node scripts/preview/run.mjs --shots scripts/preview/swipe-shots.mjs --out <dir> [--dark]
// `drag` keeps the pointer down, so each *-swipe-* shot is the row mid-swipe.
const listRow = '휴대폰 사진 백업';
const todayRow = '우유랑 계란 사기';

const shots = [
  { name: 'lists', path: '/inbox' },
  { name: 'lists-swipe-right', path: '/inbox', steps: [{ drag: { text: listRow, dx: 150 } }] },
  { name: 'lists-swipe-right-far', path: '/inbox', steps: [{ drag: { text: listRow, dx: 330 } }] },
  { name: 'lists-swipe-left', path: '/inbox', steps: [{ drag: { text: listRow, dx: -150 } }] },
  { name: 'lists-swipe-left-far', path: '/inbox', steps: [{ drag: { text: listRow, dx: -330 } }] },
  // Released past the threshold: snaps a, b, c follow the
  // row settling back checked and leaving; the shot itself is the list afterwards.
  { name: 'lists-swiped-right', path: '/inbox', steps: [
    { drag: { text: listRow, dx: 200, release: true }, noSettle: true },
    { wait: 60, noSettle: true }, { snap: 'a' }, { wait: 120, noSettle: true }, { snap: 'b' }, { wait: 200, noSettle: true }, { snap: 'c' },
  ] },
  { name: 'lists-swiped-left', path: '/inbox', steps: [{ drag: { text: listRow, dx: -200, release: true } }] },
  // Mid tab change: snaps a and b are taken 40 and 120 ms after tapping the tab.
  // (From 예정: on 오늘 the first '목록' label is the view switch, not the tab.)
  { name: 'lists-from-upcoming', path: '/upcoming', steps: [
    { click: { label: '목록' }, noSettle: true }, { wait: 40, noSettle: true }, { snap: 'a' }, { wait: 80, noSettle: true }, { snap: 'b' }, { wait: 300 },
  ] },
  { name: 'today-from-lists', path: '/inbox', steps: [
    { click: { label: '오늘' }, noSettle: true }, { wait: 40, noSettle: true }, { snap: 'a' }, { wait: 80, noSettle: true }, { snap: 'b' }, { wait: 300 },
  ] },
  { name: 'today', path: '/' },
  { name: 'today-swipe-right', path: '/', steps: [{ drag: { text: todayRow, dx: 150 } }] },
  { name: 'today-swipe-left', path: '/', steps: [{ drag: { text: todayRow, dx: -150 } }] },
  { name: 'today-back-from-detail', path: '/', steps: [{ click: { text: todayRow } }, { wait: 400 }, { click: { label: '뒤로' } }, { wait: 300 }] },
];

export default shots;
