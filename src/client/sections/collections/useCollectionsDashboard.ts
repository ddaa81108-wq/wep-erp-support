import { useCallback, useEffect, useState } from 'react';
import { api, type CollectionAssignment, type CollectionsDashboard } from '../../api.ts';
import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';

export const collectionMoney = new Intl.NumberFormat('ar-LY');
export const collectionError = (value: unknown) => value instanceof Error ? value.message : 'تعذر تنفيذ العملية.';

export function assignmentTone(assignment: CollectionAssignment, admin = false) {
  const hasNewMovement = assignment.latestSubmissionAt === null
    || Date.parse(assignment.externalFinancialUpdatedAt) > Date.parse(assignment.latestSubmissionAt);
  if (hasNewMovement) return 'collection-base';
  if (admin && assignment.latestCashReceivedAt) return 'collection-red';
  if (assignment.balanceUnits === 0 || assignment.latestMode === 'full') return 'collection-green';
  if (assignment.latestMode === 'partial') return 'collection-yellow';
  return 'collection-base';
}

export function useCollectionsDashboard() {
  const [data, setData] = useState<CollectionsDashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => api.collections().then(setData).catch((caught) => setError(collectionError(caught))), []);
  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh({
    topics: ['collection.changed', 'customer.ledger.changed', 'company.ledger.changed'],
    cursorKey: 'abdo:collections-last-event',
    onChange: () => load(),
  });
  async function run(id: string, operation: () => Promise<unknown>) {
    setBusy(id); setError('');
    try { await operation(); await load(); }
    catch (caught) { setError(collectionError(caught)); }
    finally { setBusy(''); }
  }
  return { data, error, busy, setError, setBusy, load, run };
}
