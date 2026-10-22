import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { uiText } from '../i18n/language.ts';
import { registerNavigationGuard } from './navigationGuards.ts';

/** Revision identifies the actual draft, so acknowledging a save cannot hide later edits. */
export function useUnsavedDraft(dirty: boolean, busy: boolean, revision: string) {
  const saved = useRef<string | null>(null);
  const approvedUnload = useRef<string | null>(null);
  const live = useRef({ dirty, busy, revision });
  useLayoutEffect(() => { live.current = { dirty, busy, revision }; }, [dirty, busy, revision]);
  const confirmLeave = useCallback(() => {
    const current = live.current;
    if (current.busy) return false;
    return !current.dirty || saved.current === current.revision || window.confirm(uiText(
      'توجد بيانات غير محفوظة. هل تريد المغادرة دون اعتمادها؟ اضغط إلغاء للرجوع للمراجعة.',
    ));
  }, []);
  useEffect(() => {
    const unregister = registerNavigationGuard(async () => confirmLeave());
    const approveUnload = () => { approvedUnload.current = live.current.revision; };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = live.current;
      if (approvedUnload.current === current.revision) {
        approvedUnload.current = null;
        return;
      }
      if (current.busy || current.dirty && saved.current !== current.revision) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('abdo:navigation-approved', approveUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('abdo:navigation-approved', approveUnload);
    };
  }, [confirmLeave]);
  return { confirmLeave, markSaved: (savedRevision = live.current.revision) => { saved.current = savedRevision; } };
}
