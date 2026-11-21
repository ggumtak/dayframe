/** Ready-made daily routines to add as habits with one tap. */
export interface Routine { name: string; cadence?: 'daily' | 'weekly'; target?: number }
export interface RoutineGroup { title: string; icon: 'sunrise' | 'heart' | 'activity' | 'feather' | 'book-open' | 'moon' | 'home' | 'users'; items: Routine[] }

export const routineGroups: RoutineGroup[] = [
  {
    title: '아침', icon: 'sunrise', items: [
      { name: '기상 후 물 한 잔' }, { name: '이부자리 정리' }, { name: '아침 스트레칭 5분' }, { name: '아침 햇볕 10분 쬐기' },
      { name: '아침 식사 챙기기' }, { name: '오늘 할 일 3가지 정하기' }, { name: '영양제 먹기' }, { name: '찬물로 세수하기' },
      { name: '아침 일기 3줄' }, { name: '정한 시간에 일어나기' }, { name: '출근 전 10분 독서' },
    ],
  },
  {
    title: '건강', icon: 'heart', items: [
      { name: '물 2리터 마시기', target: 8 }, { name: '과일 한 번 먹기' }, { name: '채소 챙겨 먹기' }, { name: '야식 안 먹기' },
      { name: '커피는 오후 2시 전까지만' }, { name: '단 음료 대신 물' }, { name: '7시간 이상 자기' }, { name: '자정 전에 눕기' },
      { name: '1시간마다 일어나 움직이기', target: 6 }, { name: '눈 쉬게 하기 (20분마다 먼 곳 보기)', target: 4 }, { name: '바른 자세 확인', target: 3 },
      { name: '양치 후 치실' },
    ],
  },
  {
    title: '운동', icon: 'activity', items: [
      { name: '걷기 30분' }, { name: '만 보 걷기' }, { name: '스쿼트 50개' }, { name: '플랭크 1분' }, { name: '푸시업 20개' },
      { name: '요가 15분' }, { name: '계단으로 다니기' }, { name: '폼롤러 10분' }, { name: '달리기', cadence: 'weekly', target: 3 },
      { name: '헬스', cadence: 'weekly', target: 3 }, { name: '수영', cadence: 'weekly', target: 2 }, { name: '자전거 타기', cadence: 'weekly', target: 2 },
    ],
  },
  {
    title: '마음', icon: 'feather', items: [
      { name: '명상 10분' }, { name: '감사한 일 3가지 쓰기' }, { name: '심호흡 다섯 번', target: 3 }, { name: '오늘 하루 돌아보기' },
      { name: 'SNS 30분 이하' }, { name: '휴대폰 없이 1시간' }, { name: '좋아하는 음악 듣기' }, { name: '산책하며 생각 정리' },
      { name: '나에게 칭찬 한 마디' }, { name: '하늘 한 번 보기' },
    ],
  },
  {
    title: '공부·성장', icon: 'book-open', items: [
      { name: '책 20분 읽기' }, { name: '영단어 30개' }, { name: '외국어 15분' }, { name: '강의 1개 듣기' }, { name: '코딩 1시간' },
      { name: '뉴스 기사 1개 읽기' }, { name: '글쓰기 15분' }, { name: '오늘 배운 것 한 줄 정리' }, { name: '자격증 공부 1시간' },
      { name: '사이드 프로젝트 30분' }, { name: '타자 연습 10분' },
    ],
  },
  {
    title: '저녁·마무리', icon: 'moon', items: [
      { name: '내일 할 일 미리 정하기' }, { name: '저녁 스트레칭' }, { name: '잠들기 1시간 전 휴대폰 내려놓기' }, { name: '스킨케어' },
      { name: '일기 쓰기' }, { name: '가계부 쓰기' }, { name: '하루 정리 10분' }, { name: '따뜻한 차 한 잔' }, { name: '내일 입을 옷 준비' },
    ],
  },
  {
    title: '생활·집안일', icon: 'home', items: [
      { name: '설거지 바로 하기' }, { name: '방 10분 정리' }, { name: '책상 정리' }, { name: '빨래', cadence: 'weekly', target: 2 },
      { name: '분리수거', cadence: 'weekly', target: 1 }, { name: '화분 물 주기', cadence: 'weekly', target: 2 }, { name: '냉장고 정리', cadence: 'weekly', target: 1 },
      { name: '이불 빨래', cadence: 'weekly', target: 1 }, { name: '지출 확인' }, { name: '메일함 비우기' },
    ],
  },
  {
    title: '관계', icon: 'users', items: [
      { name: '가족에게 연락하기', cadence: 'weekly', target: 2 }, { name: '친구에게 안부 묻기', cadence: 'weekly', target: 1 },
      { name: '고마운 사람에게 한마디' }, { name: '반려동물 산책' }, { name: '함께 식사하기', cadence: 'weekly', target: 2 },
    ],
  },
];

/** "매일", "하루 8번", "주 3회" — how often the routine asks to be done. */
export function routineLabel(routine: Routine): string {
  if (routine.cadence === 'weekly') return '주 ' + (routine.target ?? 1) + '회';
  return (routine.target ?? 1) > 1 ? '하루 ' + routine.target + '번' : '매일';
}

/** Names compared without spaces or case, so "물 2리터 마시기" matches "물2리터 마시기". */
export const sameRoutine = (a: string, b: string) => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
