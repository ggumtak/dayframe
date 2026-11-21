import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { type QuickAddDefaults, useQuickAdd } from '@/features/quick-add/QuickAdd';

/** While this screen is focused, the floating add button creates tasks with these defaults. */
export function useScreenDefaults(defaults: QuickAddDefaults) {
  const { setScreenDefaults } = useQuickAdd();
  const { dueToday, projectId, initialText } = defaults;
  useFocusEffect(useCallback(() => {
    setScreenDefaults({ dueToday, projectId, initialText });
    return () => setScreenDefaults(null);
  }, [dueToday, projectId, initialText, setScreenDefaults]));
}
