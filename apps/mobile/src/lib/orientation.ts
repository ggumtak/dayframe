import { lockAsync, OrientationLock } from 'expo-screen-orientation';
import { AppState, Dimensions, Platform } from 'react-native';

import { isTabletSize } from './layout';

/**
 * app.config.ts lets the activity follow the sensor (`orientation: 'default'`); phones are held to portrait here,
 * once at startup, as they were before tablets were supported. The physical screen decides, not the window, so a
 * tablet in split screen still rotates. Not awaited: the first render does not wait for it.
 */
export function keepPhonesPortrait() {
  if (Platform.OS !== 'android') return;
  const { width, height } = Dimensions.get('screen');
  if (isTabletSize(width, height)) return;
  let locked = false;
  const lock = () => {
    lockAsync(OrientationLock.PORTRAIT_UP).then(() => { locked = true; }, () => {
      // No activity yet (the bundle can run before the activity resumes): tried again when the app becomes active.
    });
  };
  lock();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    if (locked) subscription.remove();
    else lock();
  });
}
