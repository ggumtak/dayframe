export interface HardwareKeyEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  editing: boolean;
  repeat: boolean;
  modal: boolean;
}

/** Returning `true` consumes the event and stops lower layers. */
export type KeyHandler = (event: HardwareKeyEvent) => boolean | void;

export const KEY_PRIORITY = {
  help: 100,
  palette: 90,
  quickAdd: 80,
  sheet: 70,
  screen: 50,
  global: 10,
} as const;

export type KeyPriority = (typeof KEY_PRIORITY)[keyof typeof KEY_PRIORITY];

export type ShortcutContextId =
  | 'today'
  | 'inbox'
  | 'upcoming'
  | 'habits'
  | 'focus'
  | 'task-detail'
  | 'search'
  | 'quick-add'
  | 'habit-detail'
  | 'habit-new'
  | 'completed'
  | 'routines'
  | 'settings'
  | 'global';

export interface ShortcutEntry {
  keys: string[];
  label: string;
  detail?: string;
}

export interface ShortcutSection {
  id: string;
  title: string;
  context?: ShortcutContextId;
  items: ShortcutEntry[];
}
