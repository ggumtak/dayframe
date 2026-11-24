// The one place the app talks to the Claude API. Every feature goes through runAi().
//
// - The SDK is imported inside the call, so it is not loaded (or parsed) while the app starts.
// - Requests are non-streaming (React Native's fetch cannot stream) and cancellable through `signal`.
// - Replies use structured outputs (`output_config.format`): forced tool use and assistant prefill are
//   rejected by these models. Thinking is always on; `output_config.effort` sets how much.
// - Opus 5.5 and Sonnet 5.5 send `fallbacks: "default"` (beta server-side-fallback-2026-07-01), so a request
//   their safety classifiers decline is retried on the model Anthropic recommends, inside the same call.
//   Haiku 5.5 has no server-side fallback. Neither could be tried against the live API when this was
//   written, so a 400 invalid_request_error on a request that sent them is retried once without them, and
//   the app stops sending them until it restarts (shouldRetryWithoutFallback in errors.ts).
// - The key is read from secure storage per request and handed only to the SDK, which sends it only to
//   api.anthropic.com. It is never logged. Errors carry a scrubbed one-line `detail` (status, error type,
//   the server's message, request id) for the "자세히" line, never the key or what was sent.
import { AiError, type AiErrorKind, classifyStatus, describeHttpFailure, describeInvalid, shouldRetryWithoutFallback } from './errors';
import { readKey } from './keyStore';
import { type AiEffort, type AiModelId, type AiUsage, hasServerFallback } from './models';
import { readAiPrefs } from './prefs';
import { CHECK_SYSTEM, CHECK_USER } from './prompts';
import type { AiSchema } from './schemas';

export type AiFeature = 'organize' | 'plan' | 'breakdown' | 'review';

export interface AiResult<T> {
  data: T;
  /** The model that was asked (pricing is shown for it). */
  model: AiModelId;
  /** The model that answered; differs when a refusal fell back to another model. */
  servedBy: string;
  usage: AiUsage;
}

/** Room for adaptive thinking plus the JSON; a short list of steps needs less. Non-streaming stays well under the SDK timeout. */
const MAX_TOKENS: Record<AiFeature, number> = { organize: 16_000, plan: 16_000, breakdown: 8_000, review: 16_000 };
const TIMEOUT_MS = 180_000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type Sdk = typeof import('@anthropic-ai/sdk');
let sdk: Promise<Sdk> | null = null;
const loadSdk = () => (sdk ??= import('@anthropic-ai/sdk'));

async function clientFor(key: string) {
  const { default: Anthropic } = await loadSdk();
  // dangerouslyAllowBrowser: React Native (and the web preview) look like a browser to the SDK. The key is
  // the device owner's own, typed on this device, and goes nowhere but Anthropic.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: TIMEOUT_MS, logLevel: 'off' });
}

/** Turns anything the SDK throws into an AiError, from its typed classes. */
async function toAiError(error: unknown, signal?: AbortSignal, note?: string): Promise<AiError> {
  const withNote = (detail: string) => (note ? `${detail} (${note})` : detail);
  if (error instanceof AiError) return error.detail && note ? new AiError(error.kind, withNote(error.detail)) : error;
  if (signal?.aborted) return new AiError('cancelled');
  const { default: Anthropic } = await loadSdk();
  if (error instanceof Anthropic.APIUserAbortError) return new AiError('cancelled');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', withNote('시간 초과 (APIConnectionTimeoutError)'));
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('offline', withNote(describeHttpFailure({ type: 'APIConnectionError', message: error.cause instanceof Error ? error.cause.message : null })));
  }
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string; details?: { error_code?: string } }; request_id?: string } | undefined;
    const message = body?.error?.message;
    const detail = describeHttpFailure({
      status: error.status, type: errorType(error), message, requestId: error.requestID ?? body?.request_id,
    });
    return new AiError(classifyStatus(error.status, errorType(error), body?.error?.details?.error_code, message), withNote(detail));
  }
  return new AiError('server', withNote(describeHttpFailure({ type: error instanceof Error ? error.name : typeof error })));
}

/** Set once the API refuses `fallbacks`; later requests in this app session go without it. */
let fallbackUnsupported = false;

function errorType(error: { error?: unknown; type?: string | null }): string | undefined {
  const body = error.error as { error?: { type?: string } } | undefined;
  return body?.error?.type ?? error.type ?? undefined;
}

async function modelAndKey(): Promise<{ key: string; model: AiModelId }> {
  const [key, prefs] = await Promise.all([readKey(), readAiPrefs()]);
  if (!key) throw new AiError('no_key');
  return { key, model: prefs.model };
}

function usageOf(usage: {
  input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
}): AiUsage {
  return {
    input: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens,
  };
}

export async function runAi<T>({ feature, system, user, schema, effort, signal }: {
  feature: AiFeature;
  system: string;
  user: string;
  schema: AiSchema<T>;
  effort: AiEffort;
  signal?: AbortSignal;
}): Promise<AiResult<T>> {
  const { key, model } = await modelAndKey();
  try {
    const client = await clientFor(key);
    const send = (withFallback: boolean) => {
      if (signal?.aborted) throw new AiError('cancelled');
      return client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS[feature],
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: { type: 'json_schema', schema: schema.json } },
        ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      }, { signal });
    };
    const withFallback = hasServerFallback(model) && !fallbackUnsupported;
    let response;
    let note: string | undefined;
    try {
      response = await send(withFallback);
    } catch (error) {
      const { default: Anthropic } = await loadSdk();
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      const type = error instanceof Anthropic.APIError ? errorType(error) : undefined;
      if (!shouldRetryWithoutFallback({ sentFallback: withFallback, status, type, aborted: !!signal?.aborted })) throw error;
      // The fallback beta (or its combination with structured outputs) was refused: drop it for the rest of
      // this app session and ask once more, unchanged otherwise.
      fallbackUnsupported = true;
      note = 'fallbacks 없이 다시 보냄';
      try {
        response = await send(false);
      } catch (retryError) {
        throw await toAiError(retryError, signal, note);
      }
    }

    // stop_reason first: a refusal or a cut-off reply may not match the schema at all.
    if (response.stop_reason === 'refusal') {
      throw new AiError('refusal', `stop_reason refusal · ${response.stop_details?.category ?? 'category 없음'} · ${response.model}`);
    }
    if (response.stop_reason === 'max_tokens' || response.stop_reason === 'model_context_window_exceeded') {
      throw new AiError('max_tokens', `stop_reason ${response.stop_reason} · 출력 ${response.usage.output_tokens} 토큰`);
    }
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AiError('invalid', `${describeInvalid(undefined, schema.rootKey)} · stop_reason ${response.stop_reason} · ${response.model}`);
    }
    const data = schema.parse(raw);
    if (data === null) throw new AiError('invalid', `${describeInvalid(raw, schema.rootKey)} · ${response.model}`);
    return { data, model, servedBy: response.model, usage: usageOf(response.usage) };
  } catch (error) {
    throw await toAiError(error, signal);
  }
}

export type CheckResult = { ok: true; model: AiModelId } | { ok: false; kind: AiErrorKind; detail: string | null };

/**
 * The "연결 확인" request: one tiny message to the chosen model, which proves the key is accepted, the
 * account has credit and the model is available. Costs a fraction of a cent.
 */
export async function checkConnection(signal?: AbortSignal): Promise<CheckResult> {
  try {
    const { key, model } = await modelAndKey();
    const client = await clientFor(key);
    await client.messages.create({
      model, max_tokens: 256, system: CHECK_SYSTEM, messages: [{ role: 'user', content: CHECK_USER }],
      output_config: { effort: 'low' },
    }, { signal });
    return { ok: true, model };
  } catch (error) {
    const failure = await toAiError(error, signal);
    return { ok: false, kind: failure.kind, detail: failure.detail };
  }
}
