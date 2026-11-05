import { uiText, displayLocale } from '../../i18n/language.ts';
import { collectionCardTone } from '../../../shared/collectionCardState.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CollectionsDashboard } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';

export const collectionMoney = new Intl.NumberFormat(displayLocale);
export const collectionError = (value: unknown) => value instanceof Error ? value.message : uiText("تعذر تنفيذ العملية.");

export const assignmentTone = collectionCardTone;

export function useCollectionsDashboard() {
  const [data, setData] = useState<CollectionsDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, commitBusy] = useState('');
  const busyRef = useRef('');
  const setBusy = useCallback((value: string) => {
    busyRef.current = value;
    commitBusy(value);
  }, []);
  const latestLoad = useRef(0);
  const snapshotKey = useRef('');
  const load = useCallback(async (quiet = false) => {
    const request = ++latestLoad.current;
    try {
      const next = await api.collections();
      if (request === latestLoad.current) {
        const key = JSON.stringify(next);
        if (key !== snapshotKey.current) { snapshotKey.current = key; setData(next); }
      }
    }
    catch (caught) { setError(collectionError(caught)); if (quiet) throw caught; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh({
    enabled: Boolean(data),
    initialSnapshotProvided: true,
    topics: ['collection.changed', 'customer.changed', 'company.changed', 'customer.ledger.changed', 'company.ledger.changed'],
    cursorKey: 'abdo:collections-last-event',
    onChange: () => load(true),
  });
  async function run(id: string, operation: () => Promise<unknown>) {
    // Lock synchronously as well as disabling controls after React renders.
    if (busyRef.current) return false;
    setBusy(id); setError('');
    try { await operation(); await load(); return true; }
    catch (caught) { setError(collectionError(caught)); return false; }
    finally { setBusy(''); }
  }
  return { data, error, busy, setError, setBusy, load, run };
}
