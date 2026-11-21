import { router } from 'expo-router';
import { useEffect } from 'react';

import { useQuickAdd } from '@/features/quick-add/QuickAdd';

/** dayframe:///add, the widget's + button: today's list with the entry bar open. */
export default function Add() {
  const quickAdd = useQuickAdd();
  useEffect(() => {
    router.replace('/');
    quickAdd.open({ dueToday: true });
  }, [quickAdd]);
  return null;
}
