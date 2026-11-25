// What can go wrong with a request, in words the owner can act on. Pure, tested with node:test.
// The friendly texts never repeat the server's message. The server's own words go only into `detail`, a
// short technical line shown folded under "자세히" so the owner can copy it to the developer; it is
// scrubbed of anything key-like and never contains what was sent.

export type AiErrorKind =
  | 'no_key' | 'bad_key' | 'no_credit' | 'permission' | 'model_unavailable' | 'rate_limit' | 'spend_limit'
  | 'overloaded' | 'server' | 'offline' | 'timeout' | 'refusal' | 'max_tokens' | 'invalid' | 'bad_request' | 'cancelled';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  /** One technical line for the developer (status, error type, the server's message), already scrubbed. */
  readonly detail: string | null;
  constructor(kind: AiErrorKind, detail: string | null = null) {
    super(kind);
    this.name = 'AiError';
    this.kind = kind;
    this.detail = detail;
  }
}

const MAX_DETAIL = 200;

/**
 * Removes anything that could be a credential: `sk-ant-…` keys, `Bearer …` values and any long unbroken
 * run of key-like characters (40 or more). Request ids (`req_…`, under 40) survive, which is what support needs.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]*/g, 'sk-ant-***')
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1***')
    .replace(/[A-Za-z0-9_\-+/=]{40,}/g, '***');
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

/** "HTTP 401 · authentication_error · invalid x-api-key · req_011…" from what the SDK error carries. */
export function describeHttpFailure(failure: {
  status?: number | null; type?: string | null; message?: string | null; requestId?: string | null;
}): string {
  const parts = [
    failure.status ? 'HTTP ' + failure.status : null,
    failure.type || null,
    failure.message ? clip(scrubSecrets(failure.message.replace(/\s+/g, ' ').trim()), MAX_DETAIL) : null,
    failure.requestId && /^req_[A-Za-z0-9]{1,39}$/.test(failure.requestId) ? failure.requestId : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '자세한 정보 없음';
}

/** A short note on why a reply failed the check, naming only the shape (never its content). */
export function describeInvalid(raw: unknown, rootKey: string): string {
  if (raw === undefined) return 'JSON 아님';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '객체 아님';
  const value = (raw as Record<string, unknown>)[rootKey];
  if (value === undefined) return `${rootKey} 없음`;
  if (Array.isArray(value) && value.length === 0) return `${rootKey} 비어 있음`;
  return `${rootKey} 형식이 다름`;
}

export const isAiError = (error: unknown): error is AiError => error instanceof AiError;

export const AI_ERROR_TEXT: Record<AiErrorKind, { title: string; message: string }> = {
  no_key: { title: 'Anthropic 키가 필요합니다', message: 'AI 비서를 사용하려면 먼저 Anthropic 키를 저장해 주세요.' },
  bad_key: { title: '키가 올바르지 않습니다', message: '유효하지 않은 키입니다. Anthropic 키를 다시 복사해 입력해 주세요.' },
  no_credit: { title: '크레딧이 부족합니다', message: 'Anthropic 콘솔에서 크레딧을 충전한 뒤 다시 시도해 주세요.' },
  permission: { title: '키 권한이 부족합니다', message: '이 키로는 요청할 수 없습니다. Anthropic 콘솔에서 키 권한과 워크스페이스 설정을 확인해 주세요.' },
  model_unavailable: { title: '선택한 모델을 사용할 수 없습니다', message: 'AI 비서 설정에서 다른 모델을 선택한 뒤 다시 시도해 주세요.' },
  rate_limit: { title: '요청이 너무 많습니다', message: '잠시 후 다시 시도해 주세요.' },
  spend_limit: { title: '이번 달 사용 한도에 도달했습니다', message: 'Anthropic 콘솔에서 월 사용 한도를 확인해 주세요.' },
  overloaded: { title: 'Anthropic 서버가 혼잡합니다', message: '잠시 후 다시 시도해 주세요.' },
  server: { title: 'Anthropic 서버에 일시적인 문제가 생겼습니다', message: '잠시 후 다시 시도해 주세요.' },
  offline: { title: '인터넷에 연결되어 있지 않습니다', message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' },
  timeout: { title: '응답 시간이 초과되었습니다', message: '잠시 후 다시 시도해 주세요.' },
  refusal: { title: '이 요청에는 응답하지 못했습니다', message: '내용을 조금 수정해 다시 시도해 주세요.' },
  max_tokens: { title: '응답이 길어 중간에 끊겼습니다', message: '내용을 줄이거나 나누어 다시 시도해 주세요.' },
  invalid: { title: 'AI 응답을 처리하지 못했습니다', message: '다시 시도해 주세요.' },
  bad_request: { title: '요청을 처리할 수 없습니다', message: '앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.' },
  cancelled: { title: '요청을 취소했습니다', message: '' },
};

/** Maps an HTTP error to a kind, from the status, the error `type` and, for 429, the spend-cap code. */
export function classifyStatus(
  status: number | undefined, type?: string | null, code?: string | null, message?: string | null,
): AiErrorKind {
  if (type === 'overloaded_error' || status === 529) return 'overloaded';
  if (type === 'authentication_error' || status === 401) return 'bad_key';
  if (type === 'billing_error' || status === 402) return 'no_credit';
  if (type === 'permission_error' || status === 403) return 'permission';
  if (type === 'not_found_error' || status === 404) return 'model_unavailable';
  if (status === 429) return code === 'enforced_spend_limit_reached' ? 'spend_limit' : 'rate_limit';
  if (status === 408) return 'timeout';
  if (status !== undefined && status >= 500) return 'server';
  // An empty prepaid balance has long been answered with a plain 400 whose only distinguishing mark is its
  // wording; billing_error (402) is the typed form. Both mean the same thing to the owner.
  if (status === 400) return message && /credit balance/i.test(message) ? 'no_credit' : 'bad_request';
  return 'server';
}

/** Whether pressing "다시 시도" right away has a chance of working. */
export const isRetryable = (kind: AiErrorKind): boolean =>
  ['rate_limit', 'overloaded', 'server', 'offline', 'timeout', 'refusal', 'max_tokens', 'invalid', 'cancelled'].includes(kind);

/**
 * Whether a failed request should be sent again without `betas`/`fallbacks`: only when it sent them and the
 * API answered 400 invalid_request_error (how an unknown beta or a refused combination is reported), and the
 * owner did not cancel. Any other failure is reported as it is.
 */
export function shouldRetryWithoutFallback(failure: {
  sentFallback: boolean; status: number | undefined; type: string | null | undefined; aborted: boolean;
}): boolean {
  return failure.sentFallback && !failure.aborted && failure.status === 400 && failure.type === 'invalid_request_error';
}
