const known: [RegExp, string][] = [
  [/one due date/, '날짜는 하나만 입력해 주세요.'],
  [/one due time/, '시간은 하나만 입력해 주세요.'],
  [/one recurrence/, '반복은 하나만 입력해 주세요.'],
  [/one #project/, '#프로젝트는 하나만 지정할 수 있습니다.'],
  [/one priority/, '우선순위는 하나만 지정할 수 있습니다.'],
  [/1–12 with AM\/PM/, '오전·오후와 함께 쓸 때는 1–12시로 입력해 주세요.'],
  [/interval must be/, '반복 간격은 1–52 사이로 입력해 주세요.'],
  [/names must have/, '프로젝트와 태그 이름은 120자 이하여야 합니다.'],
];

/** Korean copy for a quick-entry parse failure. An empty title is not worth an error message. */
export function parseErrorMessage(error: unknown): string | null {
  const text = error instanceof Error ? error.message : '';
  if (/Task title must have/.test(text)) return null;
  if (error instanceof RangeError) return '달력에 없는 날짜나 시간입니다.';
  return known.find(([pattern]) => pattern.test(text))?.[1] ?? '날짜나 시간을 이해하지 못했습니다.';
}
