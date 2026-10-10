import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, CustomerFilter, Ledger } from '../api.ts';
import {
  getSectionAccount,
  getSectionLedger,
  listSectionAccounts,
  setSectionPinned,
} from '../sections/debts/debtSectionApi.ts';
import type { DebtSection, MainSection } from '../sections/debts/sectionConfig.ts';
import { useDebtRealtime } from '../sections/debts/useDebtRealtime.ts';
import { dashboardErrorText, visibleCustomerCards } from './dashboardModel.ts';
import type { DashboardNotice } from './dashboardTypes.ts';
import {
  appendCustomerPage,
  mergeCustomerSnapshots,
  mergeFreshLedger,
  prependOlderLedgerPage,
} from './debtAccountState.ts';

type UseDebtAccountsOptions = {
  activeSection: MainSection;
  debtSection: DebtSection;
  canRead: boolean;
  onNotice: (notice: DashboardNotice) => void;
};

export function useDebtAccounts({ activeSection, debtSection, canRead, onNotice }: UseDebtAccountsOptions) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listSummary, setListSummary] = useState({ totalDebt: 0, activeCards: 0, totalItems: 0 });
  const [filter, setFilter] = useState<CustomerFilter>('smart');
  const openLedgerId = useRef<string | null>(null);
  const pendingLedgerTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadCustomers = useCallback(
    async (cursor: string | null = null, append = false) => {
      const options = { cursor, query: debouncedQuery, filter, limit: 100 };
      const result = await listSectionAccounts(debtSection, options);
      setCustomers((current) => (append ? appendCustomerPage(current, result.items) : result.items));
      setNextCursor(result.nextCursor);
      setListSummary({ ...result.summary, totalItems: result.totalItems });
    },
    [debtSection, debouncedQuery, filter],
  );

  const fetchCustomer = useCallback((id: string) => getSectionAccount(debtSection, id), [debtSection]);
  const fetchLedger = useCallback(
    (id: string, before?: string | null) => getSectionLedger(debtSection, id, before),
    [debtSection],
  );
  const loadLedger = useCallback(
    async (id: string) => {
      setLedger(await fetchLedger(id));
    },
    [fetchLedger],
  );
  const loadOlderLedger = useCallback(async () => {
    if (!ledger?.nextCursor) return;
    const older = await fetchLedger(ledger.customer.id, ledger.nextCursor);
    setLedger((current) => prependOlderLedgerPage(current, older));
  }, [fetchLedger, ledger]);

  const mergeCustomers = useCallback((snapshots: Customer[]) => {
    setCustomers((current) => mergeCustomerSnapshots(current, snapshots));
  }, []);
  const mergeCustomer = useCallback((snapshot: Customer) => mergeCustomers([snapshot]), [mergeCustomers]);
  const refreshCustomer = useCallback(
    async (id: string) => {
      mergeCustomer(await fetchCustomer(id));
    },
    [fetchCustomer, mergeCustomer],
  );

  const refreshLedgerWhenIdle = useCallback(
    (id: string) => {
      if (pendingLedgerTimer.current !== null) window.clearTimeout(pendingLedgerTimer.current);
      const attempt = async () => {
        if (openLedgerId.current !== id) {
          pendingLedgerTimer.current = null;
          return;
        }
        const active = document.activeElement;
        const isEditing =
          active instanceof HTMLElement &&
          Boolean(active.closest('.ledger-panel')) &&
          /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
        if (isEditing) {
          pendingLedgerTimer.current = window.setTimeout(() => void attempt(), 600);
          return;
        }
        try {
          const next = await fetchLedger(id);
          setLedger((current) => mergeFreshLedger(current, next, id));
        } catch (error) {
          onNotice({ kind: 'error', text: dashboardErrorText(error) });
        }
        pendingLedgerTimer.current = null;
      };
      pendingLedgerTimer.current = window.setTimeout(() => void attempt(), 250);
    },
    [fetchLedger, onNotice],
  );

  useEffect(() => {
    openLedgerId.current = ledger?.customer.id ?? null;
  }, [ledger?.customer.id]);
  useEffect(
    () => () => {
      if (pendingLedgerTimer.current !== null) window.clearTimeout(pendingLedgerTimer.current);
    },
    [],
  );
  useEffect(() => {
    setLedger(null);
    setCustomers([]);
    setQuery('');
    setDebouncedQuery('');
    setFilter('smart');
    setNextCursor(null);
  }, [activeSection]);
  useEffect(() => {
    if (
      activeSection === 'settings' ||
      activeSection === 'collections' ||
      activeSection === 'masraweya' ||
      activeSection === 'purchases' ||
      activeSection === 'treasury' ||
      activeSection === 'reports' ||
      !canRead
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadCustomers()
      .catch((error) => onNotice({ kind: 'error', text: dashboardErrorText(error) }))
      .finally(() => setLoading(false));
  }, [activeSection, canRead, loadCustomers, onNotice]);

  const handleRealtimeError = useCallback(
    (error: unknown) => onNotice({ kind: 'error', text: dashboardErrorText(error) }),
    [onNotice],
  );
  useDebtRealtime({
    activeSection,
    canRead,
    debtSection,
    openLedgerId,
    fetchCustomer,
    loadCustomers,
    mergeCustomers,
    refreshLedgerWhenIdle,
    onError: handleRealtimeError,
  });

  async function loadMoreCustomers() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadCustomers(nextCursor, true);
    } catch (error) {
      onNotice({ kind: 'error', text: dashboardErrorText(error) });
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshOpenLedger() {
    if (ledger) await Promise.all([refreshCustomer(ledger.customer.id), loadLedger(ledger.customer.id)]);
  }

  async function togglePinned(customer: Customer) {
    try {
      const body = { expectedVersion: customer.version, isPinned: !customer.isPinned };
      await setSectionPinned(debtSection, customer.id, body);
      await refreshCustomer(customer.id);
      if (ledger?.customer.id === customer.id) await loadLedger(customer.id);
    } catch (error) {
      onNotice({ kind: 'error', text: dashboardErrorText(error) });
    }
  }

  return {
    customers,
    visibleCustomers: visibleCustomerCards(customers, debouncedQuery, filter),
    ledger,
    openLedgerSnapshot: setLedger,
    closeLedger: () => setLedger(null),
    query,
    setQuery,
    filter,
    setFilter,
    loading,
    loadingMore,
    hasMore: Boolean(nextCursor),
    listSummary,
    loadLedger,
    loadOlderLedger,
    loadMoreCustomers,
    refreshOpenLedger,
    togglePinned,
    mergeCustomer,
    refreshCustomer,
  };
}
