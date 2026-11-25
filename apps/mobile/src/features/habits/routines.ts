import { HABIT_COLORS } from './palette.ts';

/** Ready-made habits for the gallery: each comes with its own emoji, colour and a short cheering line. */
export interface Routine {
  name: string;
  emoji: string;
  color: string;
  /** A short line to cheer oneself on, kept to about 18 characters so it fits on one line of a card. */
  quote: string;
  cadence?: 'daily' | 'weekly';
  target?: number;
}
export type RoutineIcon = 'star' | 'sunrise' | 'heart' | 'activity' | 'feather' | 'book-open' | 'moon' | 'home' | 'users';
export interface RoutineGroup { title: string; icon: RoutineIcon; items: Routine[] }

const [BLUE, GREEN, ORANGE, RED, PURPLE, TEAL, PINK, SLATE] = HABIT_COLORS;

type Extra = Pick<Routine, 'cadence' | 'target'>;
const r = (name: string, emoji: string, color: string, quote: string, extra: Extra = {}): Routine => ({ name, emoji, color, quote, ...extra });
const weekly = (target: number): Extra => ({ cadence: 'weekly', target });
const times = (target: number): Extra => ({ target });

export const routineGroups: RoutineGroup[] = [
  {
    title: '아침', icon: 'sunrise', items: [
      r('기상 후 물 한 잔', '💧', BLUE, '몸을 깨우는 첫 모금'),
      r('이부자리 정리', '🛏️', TEAL, '정돈된 방에서 시작'),
      r('아침 스트레칭 5분', '🤸', GREEN, '굳은 몸을 가볍게 풀기'),
      r('아침 햇볕 10분 쬐기', '🌞', ORANGE, '따뜻한 햇살로 기분 전환'),
      r('아침 식사 챙기기', '🍳', ORANGE, '든든하게 하루 시작'),
      r('오늘 할 일 3가지 정하기', '📝', BLUE, '오늘의 핵심 세 가지'),
      r('영양제 먹기', '💊', PINK, '잊지 않고 챙기기'),
      r('찬물로 세수하기', '🚿', TEAL, '상쾌하게 잠 깨우기'),
      r('아침 일기 3줄', '✍️', PURPLE, '아침 생각 가볍게 비우기'),
      r('정한 시간에 일어나기', '⏰', RED, '하루의 리듬 지키기'),
      r('출근 전 10분 독서', '📖', PURPLE, '나만의 조용한 10분'),
    ],
  },
  {
    title: '건강', icon: 'heart', items: [
      r('물 2리터 마시기', '💧', BLUE, '한 잔씩 자주 수분 채우기', times(8)),
      r('과일 한 번 먹기', '🍎', RED, '달콤한 비타민 충전'),
      r('채소 챙겨 먹기', '🥗', GREEN, '접시에 초록 한 줌'),
      r('야식 안 먹기', '🌙', SLATE, '가벼운 속으로 꿀잠'),
      r('커피는 오후 2시 전까지만', '☕', ORANGE, '편안한 밤잠 지키기'),
      r('단 음료 대신 물', '🥤', TEAL, '가볍고 맑은 수분 충전'),
      r('7시간 이상 자기', '😴', PURPLE, '잘 자는 것도 실력'),
      r('자정 전에 눕기', '🛌', SLATE, '내일의 나를 위해'),
      r('1시간마다 일어나 움직이기', '🚶', GREEN, '잠깐 일어나 기지개', times(6)),
      r('눈 쉬게 하기 (20분마다 먼 곳 보기)', '👀', TEAL, '먼 곳 보며 눈 쉬어 주기', times(4)),
      r('바른 자세 확인', '🧍', BLUE, '어깨 펴고 바른 자세 유지', times(3)),
      r('양치 후 치실', '🦷', TEAL, '오래가는 상쾌한 개운함'),
    ],
  },
  {
    title: '운동', icon: 'activity', items: [
      r('걷기 30분', '🚶', GREEN, '걸으며 머리 맑게 비우기'),
      r('만 보 걷기', '👟', GREEN, '한 걸음이 만 걸음'),
      r('스쿼트 50개', '🦵', ORANGE, '튼튼한 하체 만들기'),
      r('플랭크 1분', '⏱️', RED, '딱 1분, 코어에 집중'),
      r('푸시업 20개', '💪', RED, '어제보다 한 개 더'),
      r('요가 15분', '🧘', PURPLE, '깊은 호흡에 몸 맡기기'),
      r('계단으로 다니기', '🪜', ORANGE, '틈새 운동의 정석'),
      r('폼롤러 10분', '🧻', TEAL, '뭉친 근육 풀어 주기'),
      r('달리기', '🏃', RED, '나만의 페이스로 달리기', weekly(3)),
      r('헬스', '🏋️', SLATE, '꾸준함이 만드는 탄탄함', weekly(3)),
      r('수영', '🏊', BLUE, '물속에서 가볍게', weekly(2)),
      r('자전거 타기', '🚴', TEAL, '바람 맞으며 가볍게 달리기', weekly(2)),
    ],
  },
  {
    title: '마음', icon: 'feather', items: [
      r('명상 10분', '🧘', PURPLE, '잠시 멈추고 숨 쉬기'),
      r('감사한 일 3가지 쓰기', '🙏', ORANGE, '작은 고마움 찾기'),
      r('심호흡 다섯 번', '🌬️', TEAL, '깊게 들이쉬고 내쉬고', times(3)),
      r('오늘 하루 돌아보기', '🪞', PURPLE, '잘한 것 하나 떠올리기'),
      r('SNS 30분 이하', '📵', SLATE, '온전한 내 시간 되찾기'),
      r('휴대폰 없이 1시간', '🔕', SLATE, '화면 밖 세상 보기'),
      r('좋아하는 음악 듣기', '🎧', PINK, '기분 전환 한 곡'),
      r('산책하며 생각 정리', '🍃', GREEN, '걸으며 마음 정돈'),
      r('나에게 칭찬 한 마디', '🌷', PINK, '오늘의 나에게 건네는 칭찬'),
      r('하늘 한 번 보기', '☁️', BLUE, '고개 들어 숨 돌리기'),
    ],
  },
  {
    title: '공부·성장', icon: 'book-open', items: [
      r('책 20분 읽기', '📚', PURPLE, '한 장씩 넓어지는 세상'),
      r('영단어 30개', '🔤', BLUE, '조금씩 늘어나는 어휘'),
      r('외국어 15분', '🗣️', TEAL, '매일 조금씩 늘어가는 말문'),
      r('강의 1개 듣기', '🎓', BLUE, '배움은 쌓이는 것'),
      r('코딩 1시간', '💻', SLATE, '한 줄씩 쌓아 가는 실력'),
      r('뉴스 기사 1개 읽기', '📰', SLATE, '세상 흐름 한 꼭지'),
      r('글쓰기 15분', '✍️', PURPLE, '생각이 글이 되는 시간'),
      r('오늘 배운 것 한 줄 정리', '💡', ORANGE, '배움을 한 줄로 남기기'),
      r('자격증 공부 1시간', '📝', RED, '목표에 한 걸음 더'),
      r('사이드 프로젝트 30분', '🛠️', ORANGE, '내 것을 만드는 시간'),
      r('타자 연습 10분', '⌨️', BLUE, '매일 더 경쾌해지는 손끝'),
    ],
  },
  {
    title: '저녁·마무리', icon: 'moon', items: [
      r('내일 할 일 미리 정하기', '🗓️', BLUE, '가볍게 맞이하는 내일 아침'),
      r('저녁 스트레칭', '🤸', GREEN, '하루의 피로 풀기'),
      r('잠들기 1시간 전 휴대폰 내려놓기', '📵', SLATE, '깊은 잠을 위한 준비'),
      r('스킨케어', '🧴', PINK, '나를 아끼는 시간'),
      r('일기 쓰기', '📔', PURPLE, '오늘의 하루 차곡차곡 기록'),
      r('가계부 쓰기', '💰', GREEN, '돈의 흐름 살피기'),
      r('하루 정리 10분', '🧺', TEAL, '깔끔하게 하루 마감'),
      r('따뜻한 차 한 잔', '🍵', ORANGE, '포근하게 마무리'),
      r('내일 입을 옷 준비', '👕', BLUE, '아침 고민 덜기'),
    ],
  },
  {
    title: '생활·집안일', icon: 'home', items: [
      r('설거지 바로 하기', '🍽️', TEAL, '쌓이기 전에 바로 끝내기'),
      r('방 10분 정리', '🧹', ORANGE, '10분으로 달라지는 공간'),
      r('책상 정리', '🗂️', BLUE, '정돈된 책상, 맑은 머리'),
      r('빨래', '🧺', TEAL, '뽀송한 기분 충전', weekly(2)),
      r('분리수거', '♻️', GREEN, '지구에게 작은 선물', weekly(1)),
      r('화분 물 주기', '🪴', GREEN, '함께 자라는 초록이', weekly(2)),
      r('냉장고 정리', '🧊', BLUE, '버릴 건 버리고 가볍게', weekly(1)),
      r('이불 빨래', '🛏️', PURPLE, '보송한 이불의 행복', weekly(1)),
      r('지출 확인', '💳', SLATE, '새는 돈 막기'),
      r('메일함 비우기', '📥', BLUE, '메일함 깔끔하게 비우기'),
    ],
  },
  {
    title: '관계', icon: 'users', items: [
      r('가족에게 연락하기', '📞', PINK, '목소리 한 번 들려주기', weekly(2)),
      r('친구에게 안부 묻기', '💬', BLUE, '짧은 안부 한마디 건네기', weekly(1)),
      r('고마운 사람에게 한마디', '💌', PINK, '표현할 때 전해지는 마음'),
      r('반려동물 산책', '🐕', ORANGE, '함께 걷는 즐거움'),
      r('함께 식사하기', '🍲', RED, '함께 나누는 따뜻한 한 끼', weekly(2)),
    ],
  },
];

/** A mix to start from: the gallery's first tab. Names point into the groups above. */
const featured = [
  '기상 후 물 한 잔', '물 2리터 마시기', '걷기 30분', '책 20분 읽기', '명상 10분', '7시간 이상 자기',
  '일기 쓰기', '스쿼트 50개', '영단어 30개', '감사한 일 3가지 쓰기', '방 10분 정리', '달리기',
];

const byName = new Map(routineGroups.flatMap((group) => group.items.map((item) => [item.name, item] as const)));

export const featuredRoutines: Routine[] = featured.flatMap((name) => {
  const item = byName.get(name);
  return item ? [item] : [];
});

/** The gallery's tabs: the featured mix first, then every group. */
export const galleryCategories: RoutineGroup[] = [{ title: '추천', icon: 'star', items: featuredRoutines }, ...routineGroups];

/** "매일", "하루 8번", "주 3회" — how often the routine asks to be done. */
export function routineLabel(routine: Pick<Routine, 'cadence' | 'target'>): string {
  if (routine.cadence === 'weekly') return '주 ' + (routine.target ?? 1) + '회';
  return (routine.target ?? 1) > 1 ? '하루 ' + routine.target + '번' : '매일';
}

/** Names compared without spaces or case, so "물 2리터 마시기" matches "물2리터 마시기". */
export const routineKey = (name: string) => name.replace(/\s+/g, '').toLowerCase();
export const sameRoutine = (a: string, b: string) => routineKey(a) === routineKey(b);
