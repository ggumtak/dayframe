import { type RefObject, useEffect } from 'react';

type Listener = (routeName: string) => void;
const listeners = new Set<Listener>();

/** Notifies the active tab screen that the user re-tapped its tab bar icon (scroll-to-top convention). */
export function emitTabReselect(routeName: string): void {
  listeners.forEach((listener) => listener(routeName));
}

/** Scrolls a ScrollView ref smoothly back to y=0 when the user re-taps the currently active tab. */
export function useTabScrollTop(routeName: string, ref: RefObject<{ scrollTo?: (opts: { y: number; animated?: boolean }) => void } | null>) {
  useEffect(() => {
    const handler: Listener = (name) => {
      if (name === routeName) ref.current?.scrollTo?.({ y: 0, animated: true });
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [routeName, ref]);
}
