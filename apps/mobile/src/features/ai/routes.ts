/** Where the AI screens live, for entry points elsewhere in the app. */
export const AI_ROUTES = {
  hub: '/assistant',
  key: '/ai-key',
  ask: '/assistant/ask',
  organize: '/assistant/organize',
  plan: '/assistant/plan',
  review: '/assistant/review',
  breakdown: '/assistant/breakdown',
} as const;

/** The breakdown screen for one task. */
export const breakdownRoute = (taskId: string) => `${AI_ROUTES.breakdown}?taskId=${encodeURIComponent(taskId)}`;
