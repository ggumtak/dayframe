import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useQuickAdd } from '@/features/quick-add/QuickAdd';

/** dayframe:///add, the widget's + button: today's list with the entry bar open (plus optional prefilled text/project). */
export default function Add() {
  const quickAdd = useQuickAdd();
  const params = useLocalSearchParams<{ text?: string; projectId?: string; dueToday?: string }>();
  useEffect(() => {
    router.replace('/');
    quickAdd.open({
      dueToday: params.dueToday !== '0',
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.text ? { initialText: params.text } : {}),
    });
  }, [quickAdd, params.text, params.projectId, params.dueToday]);
  return null;
}
