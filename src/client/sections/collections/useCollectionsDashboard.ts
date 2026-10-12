import { collectionCardTone } from '../../../shared/collectionCardState.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CollectionsDashboard } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';

export const collectionMoney = new Intl.NumberFormat('ar-LY');
export const collectionError = (value: unknown) => value instanceof Error ? value.message : 'تعذر تنفيذ العملية.';

export const assignmentTone = collectionCardTone;

export function useCollectionsDashboard() {
  const [data, setData] = useState<CollectionsDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const latestLoad = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const request = ++latestLoad.current;
    try { const next = await api.collections(); if (request === latestLoad.current) setData(next); }
    catch (caught) { setError(collectionError(caught)); if (quiet) throw caught; }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh({
    topics: ['collection.changed', 'customer.changed', 'company.changed', 'customer.ledger.changed', 'company.ledger.changed'],
    cursorKey: 'abdo:collections-last-event',
    onChange: () => load(true),
  });
  async function run(id: string, operation: () => Promise<unknown>) {
    setBusy(id); setError('');
    try { await operation(); await load(); }
    catch (caught) { setError(collectionError(caught)); }
    finally { setBusy(''); }
  }
  return { data, error, busy, setError, setBusy, load, run };
}
