export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  /** Runs when the toast goes away without its action being used. */
  onDismiss?: () => void;
}

type Listener = (toast: Toast) => void;
const listeners = new Set<Listener>();
let counter = 0;

/** Shows a short message from anywhere, including outside React (query caches, timers). */
export function showToast(message: string, options: Omit<Toast, 'id' | 'message'> = {}): void {
  const toast: Toast = { id: ++counter, message, ...options };
  if (listeners.size === 0) toast.onDismiss?.();
  listeners.forEach((listener) => listener(toast));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
