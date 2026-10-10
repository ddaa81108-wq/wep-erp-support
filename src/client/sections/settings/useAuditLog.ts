import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type AuditEntry } from '../../api.ts';
import { filterAuditEntries, type AuditFilter } from './auditLogModel.ts';

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : 'تعذر تحميل سجل التدقيق.');

export function useAuditLog() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AuditFilter>('all');

  const load = useCallback(async (before?: number | null) => {
    setBusy(true);
    setError('');
    try {
      const page = await api.auditLog(before);
      setItems((current) => (before ? [...current, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => filterAuditEntries(items, query, filter), [filter, items, query]);

  return {
    items,
    visible,
    nextBefore,
    busy,
    error,
    query,
    setQuery,
    filter,
    setFilter,
    load,
  };
}
