import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useQuickAdd } from '@/features/quick-add/QuickAdd';

/** dayframe:///add, the widget's + button: today's list with the entry bar open (plus optional prefilled text/project). */
export default function Add() {
  const quickAdd = useQuickAdd();
  const params = useLocalSearchParams<{ text?: string; projectId?: string; dueToday?: string }>();
  const quickAddRef = useRef(quickAdd);
  useEffect(() => {
    quickAddRef.current = quickAdd;
  }, [quickAdd]);

  useEffect(() => {
    router.replace('/');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const raf = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        timer = null;
        quickAddRef.current.open({
          dueToday: params.dueToday !== '0',
          ...(params.projectId ? { projectId: params.projectId } : {}),
          ...(params.text ? { initialText: params.text } : {}),
        });
      }, 120);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [params.text, params.projectId, params.dueToday]);
  return null;
}
