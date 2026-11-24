import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deriveLayout, type Layout, sameLayout } from './layout';

// A phone-sized default, so anything rendered outside the provider lays out exactly as it did before tablets.
const LayoutContext = createContext<Layout>(deriveLayout(412, 915));

/**
 * The one window-size subscription in the app. Screens read the derived measurements with `useLayout()`; a window
 * change that alters none of them (a 1 dp resize) hands back the same object, so no consumer re-renders.
 * Scrolling never touches it.
 */
export function LayoutProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const next = useMemo(() => deriveLayout(width, height, top), [width, height, top]);
  const [layout, setLayout] = useState(next);
  // Adopted during render (React's "adjust state when an input changes"), so a rotation lays out once, not twice.
  if (layout !== next && !sameLayout(layout, next)) setLayout(next);
  return <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>;
}

export const useLayout = () => useContext(LayoutContext);
