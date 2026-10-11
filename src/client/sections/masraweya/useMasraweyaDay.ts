import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../../api.ts';
import { registerNavigationGuard } from '../../dashboard/navigationGuards.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { masraweyaTotals, masraweyaAccessState } from './masraweyaModel.ts';
import { MasraweyaEditor } from './masraweyaEditor.ts';

export function useMasraweyaDay(canWrite: boolean) {
  const [editor] = useState(
    () => new MasraweyaEditor({ load: api.masraweyaDay, save: api.saveMasraweyaDay }),
  );
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot);
  const [followToday, setFollowToday] = useState(true);
  useEffect(() => {
    void editor.load();
    const unregister = registerNavigationGuard(editor.flush);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.snapshot().dirty || editor.snapshot().busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unregister();
      editor.dispose();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [editor]);
  useEffect(() => {
    const refresh = () => {
      void editor.refresh(followToday);
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [editor, followToday]);
  useRealtimeRefresh({
    topics: ['masraweya.changed'],
    cursorKey: 'abdo:masraweya-last-event',
    enabled: Boolean(state.day),
    onChange: () => editor.refresh(followToday),
  });
  return {
    ...state,
    ...masraweyaTotals(state.rows, state.previous, state.purchases),
    ...masraweyaAccessState(state.day, canWrite, state.loading),
    date: state.day?.businessDate ?? '',
    changeDate: async (date: string) => {
      await editor.changeDate(date);
      if (editor.snapshot().day?.businessDate === date && !editor.snapshot().error)
        setFollowToday(date === editor.snapshot().day?.today);
    },
    goToday: async () => {
      setFollowToday(true);
      if (await editor.flush()) await editor.load();
    },
    editRow: editor.editRow.bind(editor),
    appendRow: editor.append.bind(editor),
    editPrevious: (value: string) => editor.edit('previous', value),
    editPurchases: (value: string) => editor.edit('purchases', value),
    flush: editor.flush,
    reload: () => editor.load(state.day?.businessDate),
  };
}
