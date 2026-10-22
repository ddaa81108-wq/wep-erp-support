import { uiText } from '../../i18n/language.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type AuditEntry } from '../../api.ts';
import { filterAuditEntries, type AuditFilter } from './auditLogModel.ts';

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : uiText("تعذر تحميل سجل التدقيق."));

export function useAuditLog() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AuditFilter>('all');
  const requestState = useRef({ sequence: 0 });

  const load = useCallback(async (before?: number | null) => {
    const sequence = ++requestState.current.sequence;
    setBusy(true);
    setError('');
    try {
      const page = await api.auditLog(before);
      if (sequence !== requestState.current.sequence) return;
      setItems((current) => (before ? [...current, ...page.items] : page.items));
      setNextBefore(page.nextBefore);
    } catch (caught) {
      if (sequence === requestState.current.sequence) setError(errorText(caught));
    } finally {
      if (sequence === requestState.current.sequence) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const state = requestState.current;
    void load();
    return () => {
      state.sequence++;
    };
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
