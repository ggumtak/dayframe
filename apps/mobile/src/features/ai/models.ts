// Models the owner can choose, what they cost, and how the key is shown. No React Native imports: tested with node:test.

export type AiModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type AiEffort = 'low' | 'medium';

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-5-5';

export const AI_MODELS: { id: AiModelId; name: string; note: string }[] = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', note: '균형 잡힌 성능 · 기본' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', note: '가장 정교함 · 두 배 비용' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', note: '가장 빠르고 저렴함' },
];

/** US dollars per million tokens (standard rate, prompts under 100K tokens). */
export const PRICING: Record<AiModelId, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export const isModelId = (value: unknown): value is AiModelId =>
  value === 'claude-opus-5-5' || value === 'claude-sonnet-5-5' || value === 'claude-haiku-5-5';

/** Haiku 5.5 has no server-side refusal fallback; the other two take `fallbacks: "default"`. */
export const hasServerFallback = (model: AiModelId): boolean => model !== 'claude-haiku-5-5';

export interface AiUsage {
  /** Every input token billed, cache reads and writes included. */
  input: number;
  /** Output tokens, thinking included (it is billed as output). */
  output: number;
}

export function estimateCostUsd(model: AiModelId, usage: AiUsage): number {
  const price = PRICING[model];
  return (usage.input * price.input + usage.output * price.output) / 1_000_000;
}

export function formatUsd(cost: number): string {
  if (!(cost > 0)) return '$0';
  if (cost < 0.001) return '$0.001 미만';
  if (cost < 0.01) return '$' + cost.toFixed(3);
  return '$' + cost.toFixed(2);
}

const count = (value: number) => Math.round(value).toLocaleString('en-US');

/** "입력 1,234 · 출력 567 토큰 · 약 $0.02" */
export function usageLine(model: AiModelId, usage: AiUsage): string {
  const cost = estimateCostUsd(model, usage);
  const price = cost < 0.001 && cost > 0 ? formatUsd(cost) : '약 ' + formatUsd(cost);
  return `입력 ${count(usage.input)} · 출력 ${count(usage.output)} 토큰 · ${price}`;
}

/** Pasted keys often carry spaces, line breaks or quotes from a chat or a note; none of those are part of a key. */
export function cleanKey(text: string): string {
  return text.replace(/[\s"'`“”‘’]/g, '');
}

/** A loose shape check, so an obvious paste mistake is caught before a request is spent on it. */
export function looksLikeKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{20,300}$/.test(key);
}

/** "sk-ant-…abcd": enough to recognise which key is saved, never enough to use it. */
export function maskKey(key: string): string {
  const tail = key.slice(-4);
  return (key.startsWith('sk-ant-') ? 'sk-ant-' : '') + '…' + tail;
}
