import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, type MasraweyaDay } from '../../api.ts';
import { useSectionSnapshots } from '../../dashboard/sectionSnapshots.tsx';
import { registerNavigationGuard } from '../../dashboard/navigationGuards.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import { masraweyaTotals, masraweyaAccessState } from './masraweyaModel.ts';
import { MasraweyaEditor } from './masraweyaEditor.ts';

export function useMasraweyaDay(canWrite: boolean) {
  const snapshots = useSectionSnapshots();
  const [editor] = useState(
    () => new MasraweyaEditor({
      load: async date => {
        const generation = snapshots.generation;
        const day = await api.masraweyaDay(date);
        if (!date) snapshots.set('masraweya', day, generation);
        return day;
      },
      save: api.saveMasraweyaDay,
    }, snapshots.get<MasraweyaDay>('masraweya')),
  );
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot);
  const [followToday, setFollowToday] = useState(true);
  const [validated, setValidated] = useState(false);
  useEffect(() => {
    void editor.load().then(() => {
      if (editor.snapshot().day && !editor.snapshot().error && !editor.snapshot().loading) setValidated(true);
    });
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
      void editor.refresh(followToday).catch(() => undefined);
    };
    // SSE delivers changes; retain an authoritative check for business-day rollover.
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [editor, followToday]);
  useRealtimeRefresh({
    topics: ['masraweya.changed'],
    cursorKey: 'abdo:masraweya-last-event',
    enabled: Boolean(state.day) && validated,
    initialSnapshotProvided: true,
    onChange: async () => {
      const before = editor.snapshot();
      if (before.dirty || before.busy || before.loading) throw new Error('Live refresh awaits the current draft');
      await editor.refresh(followToday);
      const after = editor.snapshot();
      if (after.dirty || after.busy || after.loading) throw new Error('Live refresh superseded by typing');
    },
  });
  return {
    ...state,
    ...masraweyaTotals(state.rows, state.previous, state.purchases),
    ...masraweyaAccessState(state.day, canWrite, state.loading || !validated),
    loading: state.loading || !validated && !state.error,
    date: state.day?.businessDate ?? '',
    changeDate: async (date: string) => {
      await editor.changeDate(date);
      if (editor.snapshot().day && !editor.snapshot().error && !editor.snapshot().loading) setValidated(true);
      if (editor.snapshot().day?.businessDate === date && !editor.snapshot().error)
        setFollowToday(date === editor.snapshot().day?.today);
    },
    goToday: async () => {
      setFollowToday(true);
      if (await editor.flush()) await editor.load();
      if (editor.snapshot().day && !editor.snapshot().error && !editor.snapshot().loading) setValidated(true);
    },
    editRow: editor.editRow.bind(editor),
    appendRow: editor.append.bind(editor),
    editPrevious: (value: string) => editor.edit('previous', value),
    editPurchases: (value: string) => editor.edit('purchases', value),
    flush: editor.flush,
    reload: async () => {
      await editor.load(followToday ? undefined : state.day?.businessDate);
      if (editor.snapshot().day && !editor.snapshot().error && !editor.snapshot().loading) setValidated(true);
    },
  };
}
