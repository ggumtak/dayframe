import { useCallback, useEffect, useRef, useState } from 'react';

import type { AiResult } from './client';
import { AiError, type AiErrorKind } from './errors';

export type AiRequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: AiResult<T> }
  | { status: 'error'; kind: AiErrorKind };

/**
 * Runs one AI request at a time for a screen: a new run cancels the previous one, `cancel` stops it, and
 * leaving the screen aborts whatever is in flight so no answer arrives (or is paid for) after it is gone.
 */
export function useAiRequest<T>() {
  const [state, setState] = useState<AiRequestState<T>>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async (request: (signal: AbortSignal) => Promise<AiResult<T>>) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ status: 'loading' });
    try {
      const result = await request(current.signal);
      if (controller.current !== current) return null;
      setState({ status: 'done', result });
      return result;
    } catch (error) {
      if (controller.current !== current) return null;
      const kind = error instanceof AiError ? error.kind : 'server';
      setState(kind === 'cancelled' ? { status: 'idle' } : { status: 'error', kind });
      return null;
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ status: 'idle' });
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, run, cancel, reset };
}
