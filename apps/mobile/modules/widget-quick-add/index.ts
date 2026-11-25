import { requireOptionalNativeModule } from 'expo';

export interface WidgetQuickAddNativeModule {
  isAvailable(): boolean;
  setAccentColor(lightHex: string, darkHex: string): void;
}

/** Android only. Null on iOS, on the web, and in builds made before the module was added. */
export default requireOptionalNativeModule<WidgetQuickAddNativeModule>('DayframeWidgetQuickAdd');
