import { requireOptionalNativeModule } from 'expo';

export interface NativeKeyEvent {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  editing: boolean;
  repeat: boolean;
  modal: boolean;
}

export interface KeySubscription {
  remove(): void;
}

interface HardwareKeysNativeModule {
  isAvailable(): boolean;
  setCaptureConfig(captureTabInInput: boolean, captureArrowsInInput: boolean): void;
  blurFocusedInput(): void;
  addListener(eventName: 'onKeyDown', listener: (event: NativeKeyEvent) => void): KeySubscription;
}

/** Android only. Null on iOS, on the web, and in builds made before the module was added. */
export default requireOptionalNativeModule<HardwareKeysNativeModule>('DayframeHardwareKeys');
