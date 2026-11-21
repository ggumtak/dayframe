/**
 * Tells the running app that something changed its data from outside the screens: a widget tap or a
 * notification button. The app reloads in response, so its alerts and lists stop showing old state.
 */
const listeners = new Set<() => void>();

export function onExternalChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function externalChange(): void {
  listeners.forEach((listener) => listener());
}
