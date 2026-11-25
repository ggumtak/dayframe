const known: [RegExp, string][] = [
  [/one due date/, '날짜는 하나만 입력해 주세요.'],
  [/one due time/, '시간은 하나만 입력해 주세요.'],
  [/one recurrence/, '반복은 하나만 입력해 주세요.'],
  [/one duration/, '소요 시간은 하나만 입력해 주세요.'],
  [/Duration must be/, '소요 시간은 1분부터 24시간 사이로 입력해 주세요.'],
  [/one #project/, '목록(#)은 하나만 지정할 수 있습니다.'],
  [/one priority/, '우선순위는 하나만 지정할 수 있습니다.'],
  [/1–12 with AM\/PM/, '오전·오후를 함께 쓸 때는 1~12시로 입력해 주세요.'],
  [/interval must be/, '반복 간격은 1~52 사이로 입력해 주세요.'],
  [/valid day of the month/, '매월 반복일은 1일부터 31일 사이로 입력해 주세요.'],
  [/Use 자정 or 00:00/, '매월 반복에는 ‘밤 12시’ 대신 ‘자정’이나 00:00으로 입력해 주세요.'],
  [/names must have/, '목록과 태그 이름은 120자 이내로 입력해 주세요.'],
];

/** Korean copy for a quick-entry parse failure. An empty title is not worth an error message. */
export function parseErrorMessage(error: unknown): string | null {
  const text = error instanceof Error ? error.message : '';
  if (/Task title must have/.test(text)) return null;
  if (error instanceof RangeError) return '올바른 날짜나 시간을 입력해 주세요.';
  return known.find(([pattern]) => pattern.test(text))?.[1] ?? '날짜나 시간을 인식하지 못했습니다.';
}
