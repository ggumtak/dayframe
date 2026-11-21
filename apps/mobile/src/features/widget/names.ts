/** Widget names as declared in app.config.ts. Kept apart so screens can name widgets without loading the widget library. */
export const WIDGETS = { today: 'Today', upcoming: 'Upcoming', habits: 'Habits', focus: 'Focus', quickAdd: 'QuickAdd' } as const;
export type WidgetName = typeof WIDGETS[keyof typeof WIDGETS];

/** Click actions the task handler understands; the rest open the app through deep links. */
export const ACTIONS = { complete: 'COMPLETE', habit: 'HABIT', startFocus: 'START_FOCUS', stopFocus: 'STOP_FOCUS' } as const;
