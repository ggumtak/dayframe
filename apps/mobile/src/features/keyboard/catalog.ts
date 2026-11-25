import type { ShortcutContextId, ShortcutSection } from './types.ts';

export const SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    id: 'global',
    title: '어디서나',
    context: 'global',
    items: [
      { keys: ['N', 'Q'], label: '빠른 할 일 추가' },
      { keys: ['Ctrl+K'], label: '커맨드 팔레트' },
      { keys: ['/', 'Ctrl+F'], label: '검색' },
      { keys: ['1~5'], label: '탭 전환', detail: '입력 중엔 Alt+1~5' },
      { keys: ['Shift+N'], label: '새 습관' },
      { keys: [','], label: '설정' },
      { keys: ['U', 'Ctrl+Z'], label: '실행 취소' },
      { keys: ['R'], label: '새로고침' },
      { keys: ['?', 'F1'], label: '단축키 안내' },
      { keys: ['Esc'], label: '닫기·뒤로' },
    ],
  },
  {
    id: 'quick-add',
    title: '빠른 추가 입력창',
    context: 'quick-add',
    items: [
      { keys: ['Enter'], label: '추가' },
      { keys: ['Ctrl+Enter'], label: '저장', detail: '메모·여러 줄 포함' },
      { keys: ['Tab', '↑', '↓'], label: '목록·태그 자동완성 선택' },
      { keys: ['Alt+1~4'], label: '우선순위' },
      { keys: ['Alt+D'], label: '달력' },
      { keys: ['Alt+M'], label: '메모 토글' },
      { keys: ['Alt+K'], label: '계속 추가' },
      { keys: ['Alt+T'], label: '그대로 저장' },
      { keys: ['Alt+O', 'Alt+N'], label: '오늘·내일 넣기' },
      { keys: ['Alt+R'], label: '알림' },
      { keys: ['Alt+I'], label: 'AI로 정리' },
      { keys: ['Esc'], label: '닫기' },
    ],
  },
  {
    id: 'task-list',
    title: '할 일 목록 공통',
    items: [
      { keys: ['J', 'K', '↑', '↓'], label: '항목 이동' },
      { keys: ['Enter'], label: '자세히 보기' },
      { keys: ['Space', 'X'], label: '완료' },
      { keys: ['S', 'D'], label: '일정 변경' },
      { keys: ['T'], label: '오늘로' },
      { keys: ['W'], label: '내일로' },
      { keys: ['Shift+1~4'], label: '우선순위' },
      { keys: ['M'], label: '빠른 메뉴' },
      { keys: ['E', '←', '→'], label: '하위 작업 펼치기·접기' },
      { keys: ['Shift+S'], label: '하위 작업 추가' },
      { keys: ['F'], label: '집중 시작' },
      { keys: ['V'], label: '여러 개 선택' },
      { keys: ['Del', '⌫'], label: '삭제' },
    ],
  },
  {
    id: 'today',
    title: '오늘 화면',
    context: 'today',
    items: [
      { keys: ['Tab', '[', ']'], label: '보기 전환', detail: '목록·타임라인·매트릭스' },
      { keys: ['P'], label: '하루 계획·일정 정리' },
      { keys: ['Shift+T'], label: '기한 지난 일 모두 오늘로' },
      { keys: ['Shift+O'], label: '보기 옵션' },
    ],
  },
  {
    id: 'inbox',
    title: '목록 화면',
    context: 'inbox',
    items: [
      { keys: ['[', ']'], label: '목록 전환' },
      { keys: ['Shift+[', 'Shift+]'], label: '필터 전환' },
      { keys: ['Alt+↑', 'Alt+↓'], label: '수동 순서 이동' },
      { keys: ['Shift+P'], label: '새 목록 만들기' },
      { keys: ['Shift+B'], label: '체크리스트 템플릿' },
      { keys: ['Shift+O'], label: '정렬 기준' },
    ],
  },
  {
    id: 'upcoming',
    title: '예정 화면',
    context: 'upcoming',
    items: [
      { keys: ['Tab'], label: '보기 전환', detail: '주·월·연' },
      { keys: ['←', '→'], label: '날짜 이동' },
      { keys: ['[', ']'], label: '주·월·연 이동' },
      { keys: ['T'], label: '오늘로 돌아가기' },
    ],
  },
  {
    id: 'habits',
    title: '습관 화면',
    context: 'habits',
    items: [
      { keys: ['J', 'K', '↑', '↓'], label: '습관 이동' },
      { keys: ['Space', 'X'], label: '오늘 체크인' },
      { keys: ['Enter'], label: '상세 보기' },
      { keys: ['M'], label: '건너뛰기·쉬어가기' },
      { keys: ['N'], label: '새 습관 만들기' },
      { keys: ['O'], label: '기록 한눈에 보기' },
      { keys: ['G'], label: '습관 갤러리' },
    ],
  },
  {
    id: 'focus',
    title: '집중 화면',
    context: 'focus',
    items: [
      { keys: ['Space', 'Enter'], label: '시작·일시정지·이어하기' },
      { keys: ['Tab', '[', ']'], label: '모드 전환' },
      { keys: ['+', '-'], label: '시간 ±5분', detail: '실행 중 +는 5분 연장' },
      { keys: ['X'], label: '바로 완료' },
      { keys: ['P'], label: '할 일·습관 연결' },
      { keys: ['T'], label: '시간 설정' },
    ],
  },
  {
    id: 'task-detail',
    title: '할 일 상세',
    context: 'task-detail',
    items: [
      { keys: ['E'], label: '제목 편집' },
      { keys: ['Shift+E'], label: '메모 편집' },
      { keys: ['A'], label: '하위 작업 추가' },
      { keys: ['X'], label: '완료' },
      { keys: ['S'], label: '일정' },
      { keys: ['P', 'Shift+1~4'], label: '우선순위' },
      { keys: ['L'], label: '목록·섹션' },
      { keys: ['T'], label: '태그' },
      { keys: ['R'], label: '반복' },
      { keys: ['U'], label: '소요 시간' },
      { keys: ['F'], label: '집중 시작' },
      { keys: ['M'], label: '더 보기' },
      { keys: ['Del'], label: '삭제' },
      { keys: ['Esc'], label: '저장 후 닫기' },
    ],
  },
  {
    id: 'search',
    title: '검색',
    context: 'search',
    items: [
      { keys: ['↑', '↓'], label: '결과 바로 이동' },
      { keys: ['Enter'], label: '선택 항목 열기' },
      { keys: ['Alt+C'], label: '완료한 일 포함 토글' },
      { keys: ['/'], label: '검색창 포커스' },
      { keys: ['Esc'], label: '초기화·닫기' },
    ],
  },
];

const SECTION_BY_ID = new Map<string, ShortcutSection>(
  SHORTCUT_SECTIONS.map((section) => [section.id, section]),
);

const TASK_LIST_CONTEXTS = new Set<ShortcutContextId>(['today', 'inbox', 'upcoming', 'search']);

export function sectionsForContext(context: ShortcutContextId): ShortcutSection[] {
  const ordered: ShortcutSection[] = [];
  const seen = new Set<string>();

  const pushSection = (section: ShortcutSection | undefined) => {
    if (!section || seen.has(section.id)) return;
    seen.add(section.id);
    ordered.push(section);
  };

  const activeSection =
    SHORTCUT_SECTIONS.find((section) => section.context === context) ?? SECTION_BY_ID.get(context);
  pushSection(activeSection);

  if (TASK_LIST_CONTEXTS.has(context)) {
    pushSection(SECTION_BY_ID.get('task-list'));
  }

  pushSection(SECTION_BY_ID.get('global'));
  pushSection(SECTION_BY_ID.get('quick-add'));

  for (const section of SHORTCUT_SECTIONS) {
    pushSection(section);
  }

  return ordered;
}
