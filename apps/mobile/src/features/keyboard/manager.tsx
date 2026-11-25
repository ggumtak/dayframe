import { useFocusEffect } from 'expo-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Keyboard, Platform } from 'react-native';

import HardwareKeys, { type NativeKeyEvent } from '../../../modules/hardware-keys';

import { normalizeWebEvent } from './normalize';
import {
  type HardwareKeyEvent,
  KEY_PRIORITY,
  type KeyHandler,
  type ShortcutContextId,
} from './types';

interface HandlerEntry {
  priority: number;
  order: number;
  handler: KeyHandler;
}

interface ContextEntry {
  id: number;
  context: ShortcutContextId;
}

export interface KeyboardContextValue {
  keyboardMode: boolean;
  setKeyboardMode: (enabled: boolean) => void;
  hasNativeModule: boolean;
  screenContext: ShortcutContextId;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  blurActiveInput: () => void;
}

interface KeyboardRegistryValue {
  registerHandler: (priority: number, handler: KeyHandler) => () => void;
  registerInputCapture: (tab: boolean, arrows: boolean) => () => void;
  pushScreenContext: (context: ShortcutContextId) => () => void;
}

export interface KeyHandlerOptions {
  priority?: number;
  enabled?: boolean;
}

export interface InputCaptureOptions {
  tab?: boolean;
  arrows?: boolean;
  enabled?: boolean;
}

const noop = () => {};
const noopCleanup = () => () => {};

const KeyboardContext = createContext<KeyboardContextValue>({
  keyboardMode: false,
  setKeyboardMode: noop,
  hasNativeModule: false,
  screenContext: 'global',
  helpOpen: false,
  openHelp: noop,
  closeHelp: noop,
  toggleHelp: noop,
  paletteOpen: false,
  openPalette: noop,
  closePalette: noop,
  togglePalette: noop,
  blurActiveInput: noop,
});

const KeyboardRegistryContext = createContext<KeyboardRegistryValue>({
  registerHandler: noopCleanup,
  registerInputCapture: noopCleanup,
  pushScreenContext: noopCleanup,
});

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [contextStack, setContextStack] = useState<ContextEntry[]>([]);

  const handlersRef = useRef<Map<number, HandlerEntry>>(new Map());
  const nextHandlerIdRef = useRef(1);
  const nextContextIdRef = useRef(1);
  const captureCountRef = useRef({ tab: 0, arrows: 0 });
  const helpOpenRef = useRef(helpOpen);
  const paletteOpenRef = useRef(paletteOpen);

  useEffect(() => {
    helpOpenRef.current = helpOpen;
    paletteOpenRef.current = paletteOpen;
  }, [helpOpen, paletteOpen]);

  const hasNativeModule = useMemo(
    () => Platform.OS === 'web' || Boolean(HardwareKeys?.isAvailable()),
    [],
  );

  const syncNativeInputCapture = useCallback(() => {
    if (Platform.OS === 'web' || !HardwareKeys) return;
    const { tab, arrows } = captureCountRef.current;
    HardwareKeys.setCaptureConfig(tab > 0, arrows > 0);
  }, []);

  const registerHandler = useCallback((priority: number, handler: KeyHandler) => {
    const id = nextHandlerIdRef.current++;
    handlersRef.current.set(id, { priority, order: id, handler });
    return () => {
      handlersRef.current.delete(id);
    };
  }, []);

  const registerInputCapture = useCallback(
    (tab: boolean, arrows: boolean) => {
      if (tab) captureCountRef.current.tab += 1;
      if (arrows) captureCountRef.current.arrows += 1;
      syncNativeInputCapture();
      return () => {
        if (tab) captureCountRef.current.tab = Math.max(0, captureCountRef.current.tab - 1);
        if (arrows) captureCountRef.current.arrows = Math.max(0, captureCountRef.current.arrows - 1);
        syncNativeInputCapture();
      };
    },
    [syncNativeInputCapture],
  );

  const pushScreenContext = useCallback((context: ShortcutContextId) => {
    const id = nextContextIdRef.current++;
    setContextStack((prev) => [...prev, { id, context }]);
    return () => {
      setContextStack((prev) => prev.filter((entry) => entry.id !== id));
    };
  }, []);

  const dispatch = useCallback((rawEvent: HardwareKeyEvent): boolean => {
    setKeyboardMode((prev) => (prev ? prev : true));

    const entries = Array.from(handlersRef.current.values());
    const modal =
      helpOpenRef.current ||
      paletteOpenRef.current ||
      entries.some((entry) => entry.priority >= KEY_PRIORITY.sheet);
    const event: HardwareKeyEvent = rawEvent.modal === modal ? rawEvent : { ...rawEvent, modal };

    entries.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : b.order - a.order));

    for (const entry of entries) {
      if (entry.handler(event) === true) {
        return true;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.defaultPrevented) return;
        const active =
          typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
        const tag = active?.tagName?.toUpperCase();
        const editing = Boolean(
          active && (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable),
        );
        const event = normalizeWebEvent(e, editing, {
          tab: captureCountRef.current.tab > 0,
          arrows: captureCountRef.current.arrows > 0,
        });
        if (!event) return;
        if (dispatch(event)) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      window.addEventListener('keydown', onKeyDown, true);
      return () => {
        window.removeEventListener('keydown', onKeyDown, true);
      };
    }

    if (!HardwareKeys || !HardwareKeys.isAvailable()) return;

    const subscription = HardwareKeys.addListener('onKeyDown', (nativeEvent: NativeKeyEvent) => {
      dispatch({
        key: nativeEvent.key,
        ctrl: nativeEvent.ctrl,
        alt: nativeEvent.alt,
        shift: nativeEvent.shift,
        meta: nativeEvent.meta,
        editing: nativeEvent.editing,
        repeat: nativeEvent.repeat,
        modal: nativeEvent.modal,
      });
    });

    return () => {
      subscription.remove();
      HardwareKeys?.setCaptureConfig(false, false);
    };
  }, [dispatch]);

  const openHelp = useCallback(() => {
    paletteOpenRef.current = false;
    helpOpenRef.current = true;
    setPaletteOpen(false);
    setHelpOpen(true);
  }, []);

  const closeHelp = useCallback(() => {
    helpOpenRef.current = false;
    setHelpOpen(false);
  }, []);

  const toggleHelp = useCallback(() => {
    if (helpOpenRef.current) {
      helpOpenRef.current = false;
      setHelpOpen(false);
    } else {
      paletteOpenRef.current = false;
      helpOpenRef.current = true;
      setPaletteOpen(false);
      setHelpOpen(true);
    }
  }, []);

  const openPalette = useCallback(() => {
    helpOpenRef.current = false;
    paletteOpenRef.current = true;
    setHelpOpen(false);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    paletteOpenRef.current = false;
    setPaletteOpen(false);
  }, []);

  const togglePalette = useCallback(() => {
    if (paletteOpenRef.current) {
      paletteOpenRef.current = false;
      setPaletteOpen(false);
    } else {
      helpOpenRef.current = false;
      paletteOpenRef.current = true;
      setHelpOpen(false);
      setPaletteOpen(true);
    }
  }, []);

  const blurActiveInput = useCallback(() => {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    HardwareKeys?.blurFocusedInput();
    Keyboard.dismiss();
  }, []);

  const screenContext: ShortcutContextId =
    contextStack.length > 0 ? contextStack[contextStack.length - 1].context : 'global';

  const registryValue = useMemo<KeyboardRegistryValue>(
    () => ({ registerHandler, registerInputCapture, pushScreenContext }),
    [pushScreenContext, registerHandler, registerInputCapture],
  );

  const contextValue = useMemo<KeyboardContextValue>(
    () => ({
      keyboardMode,
      setKeyboardMode,
      hasNativeModule,
      screenContext,
      helpOpen,
      openHelp,
      closeHelp,
      toggleHelp,
      paletteOpen,
      openPalette,
      closePalette,
      togglePalette,
      blurActiveInput,
    }),
    [
      blurActiveInput,
      closeHelp,
      closePalette,
      hasNativeModule,
      helpOpen,
      keyboardMode,
      openHelp,
      openPalette,
      paletteOpen,
      screenContext,
      toggleHelp,
      togglePalette,
    ],
  );

  return (
    <KeyboardRegistryContext.Provider value={registryValue}>
      <KeyboardContext.Provider value={contextValue}>{children}</KeyboardContext.Provider>
    </KeyboardRegistryContext.Provider>
  );
}

export function useKeyboard(): KeyboardContextValue {
  return useContext(KeyboardContext);
}

export function useKeyHandler(handler: KeyHandler, options?: KeyHandlerOptions): void {
  const { registerHandler } = useContext(KeyboardRegistryContext);
  const handlerRef = useRef(handler);
  const priority = options?.priority ?? KEY_PRIORITY.screen;
  const enabled = options?.enabled !== false;

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerHandler(priority, (event) => handlerRef.current(event));
  }, [enabled, priority, registerHandler]);
}

export function useInputCapture(options: InputCaptureOptions): void {
  const { registerInputCapture } = useContext(KeyboardRegistryContext);
  const tab = Boolean(options.tab);
  const arrows = Boolean(options.arrows);
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled || (!tab && !arrows)) return;
    return registerInputCapture(tab, arrows);
  }, [arrows, enabled, registerInputCapture, tab]);
}

export function useScreenContext(context: ShortcutContextId, enabled = true): void {
  const { pushScreenContext } = useContext(KeyboardRegistryContext);

  useEffect(() => {
    if (!enabled) return;
    return pushScreenContext(context);
  }, [context, enabled, pushScreenContext]);
}

/** Tracks whether the enclosing Expo Router screen is currently focused (vital for mounted tab screens). */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  return focused;
}
