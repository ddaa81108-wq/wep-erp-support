import { uiText } from '../i18n/language.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Customer, CustomerFilter, Ledger, ConfirmedLedgerWrite } from '../api.ts';
import { api } from '../api.ts';
import { flushBeforeNavigation } from './navigationGuards.ts';
import { oldestLedgerSequence, readLedgerWindow } from './ledgerReadWindow.ts';
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
  applyConfirmedLedgerWrite,
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
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listSummary, setListSummary] = useState({
    totalDebt: 0,
    activeCards: 0,
    totalItems: 0,
    netBalance: 0,
    pendingReviewCount: 0,
  });
  const [filter, setFilter] = useState<CustomerFilter>('smart');
  const listKey = JSON.stringify([debtSection, debouncedQuery, filter]);
  const [settledListKey, setSettledListKey] = useState('');
  const listRequest = useRef(0);
  const ledgerRequest = useRef(0);
  const loadedPages = useRef(1);
  const customerCache = useRef<Customer[]>([]);
  useEffect(() => {
    customerCache.current = customers;
  }, [customers]);
  const openLedgerId = useRef<string | null>(null);
  const ledgerCache = useRef<Ledger | null>(null);
  useEffect(() => {
    ledgerCache.current = ledger;
  }, [ledger]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadCustomers = useCallback(
    async (
      cursor: string | null = null,
      append = false,
      background = false,
      retrySuperseded = background,
    ) => {
      const request = ++listRequest.current;
      try {
        const pages = background ? loadedPages.current : 1;
        const cached = customerCache.current;
        const cache = new Map(cached.map((customer) => [customer.id, customer]));
        const readPage = async (pageCursor: string | null, pageIndex: number) => {
          const pageCache = background ? cached.slice(pageIndex * 100, (pageIndex + 1) * 100) : [];
          const tags = pageCache
            .map((item) => item.viewTag)
            .filter((value): value is string => Boolean(value));
          const options = { cursor: pageCursor, query: debouncedQuery, filter, limit: 100 };
          let result = await listSectionAccounts(debtSection, {
            ...options,
            ...(tags.length === pageCache.length && tags.length ? { known: tags } : {}),
          });
          if (result.orderedIds) {
            for (const item of result.items) cache.set(item.id, item);
            if (result.orderedIds.some((id) => !cache.has(id)))
              result = await listSectionAccounts(debtSection, options);
            else result = { ...result, items: result.orderedIds.map((id) => cache.get(id)!) };
          }
          return result;
        };
        let result = await readPage(cursor, 0);
        const items = [...result.items];
        for (let page = 1; page < pages && result.nextCursor; page += 1) {
          result = await readPage(result.nextCursor, page);
          items.push(...result.items);
        }
        if (request !== listRequest.current) {
          if (retrySuperseded) throw new Error('Background list refresh superseded');
          return;
        }
        setCustomers((current) => (append ? appendCustomerPage(current, items) : items));
        setNextCursor(result.nextCursor);
        setListSummary({
          ...result.summary,
          pendingReviewCount: result.summary.pendingReviewCount ?? 0,
          netBalance: result.summary.netBalance ?? items.reduce((sum, item) => sum + item.balanceUnits, 0),
          totalItems: result.totalItems,
        });
        loadedPages.current = append ? loadedPages.current + 1 : Math.max(1, Math.ceil(items.length / 100));
        setLoadError(false);
        setSettledListKey(listKey);
        setLoading(false);
      } catch (error) {
        if (request === listRequest.current) {
          setLoadError(true);
          setSettledListKey(listKey);
          setLoading(false);
        }
        throw error;
      }
    },
    [debtSection, debouncedQuery, filter, listKey],
  );

  useEffect(
    () => () => {
      listRequest.current += 1;
    },
    [loadCustomers],
  );
  const refreshList = useCallback(() => loadCustomers(null, false, true), [loadCustomers]);
  const refreshAfterMutation = useCallback(() => loadCustomers(null, false, true, false), [loadCustomers]);

  const fetchCustomer = useCallback((id: string) => getSectionAccount(debtSection, id), [debtSection]);
  const fetchLedger = useCallback(
    (id: string, before?: string | null) => getSectionLedger(debtSection, id, before),
    [debtSection],
  );
  const loadLedger = useCallback(
    async (id: string) => {
      if (openLedgerId.current && openLedgerId.current !== id && !(await flushBeforeNavigation())) return;
      const request = ++ledgerRequest.current;
      const next = await fetchLedger(id);
      if (request !== ledgerRequest.current) return;
      setLedger((current) =>
        current?.customer.id === id && current.customer.version > next.customer.version ? current : next,
      );
    },
    [fetchLedger],
  );
  const loadOlderLedger = useCallback(async () => {
    const snapshot = ledgerCache.current;
    if (!snapshot?.nextCursor) return;
    const id = snapshot.customer.id;
    try {
      const older = await fetchLedger(id, snapshot.nextCursor);
      const latest = ledgerCache.current;
      if (latest?.customer.id !== id) return;
      if (older.customer.version !== latest.customer.version) {
        const oldest = Math.min(
          oldestLedgerSequence(latest) ?? Infinity,
          oldestLedgerSequence(older) ?? Infinity,
        );
        const next = await readLedgerWindow(fetchLedger, id, Number.isFinite(oldest) ? oldest : undefined);
        setLedger((current) => mergeFreshLedger(current, next, id));
      } else {
        setLedger((current) => prependOlderLedgerPage(current, older));
      }
    } catch (error) {
      if (openLedgerId.current === id) onNotice({ kind: 'error', text: dashboardErrorText(error) });
    }
  }, [fetchLedger, onNotice]);

  const mergeCustomers = useCallback((snapshots: Customer[]) => {
    setCustomers((current) => mergeCustomerSnapshots(current, snapshots));
  }, []);
  const mergeCustomer = useCallback((snapshot: Customer) => mergeCustomers([snapshot]), [mergeCustomers]);
  const refreshCustomer = useCallback(
    async (id: string) => {
      await Promise.all([fetchCustomer(id).then(mergeCustomer), refreshAfterMutation()]);
    },
    [fetchCustomer, mergeCustomer, refreshAfterMutation],
  );

  const refreshLedger = useCallback(
    async (id: string) => {
      if (openLedgerId.current !== id) return;
      await Promise.all([
        fetchLedger(id).then(async (first) => {
          const current = ledgerCache.current;
          if (current?.customer.id !== id) return;
          const next =
            first.customer.version > current.customer.version
              ? await readLedgerWindow(fetchLedger, id, oldestLedgerSequence(current), first)
              : first;
          setLedger((previous) => mergeFreshLedger(previous, next, id));
        }),
        fetchCustomer(id).then((snapshot) =>
          setCustomers((current) => {
            const previous = current.find((customer) => customer.id === id);
            return previous && previous.version <= snapshot.version
              ? mergeCustomerSnapshots(current, [snapshot])
              : current;
          }),
        ),
      ]);
    },
    [fetchLedger, fetchCustomer],
  );

  useEffect(() => {
    openLedgerId.current = ledger?.customer.id ?? null;
  }, [ledger?.customer.id]);
  useEffect(() => {
    ledgerRequest.current++;
    setLedger(null);
    setCustomers([]);
    setSettledListKey('');
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
    setLoadError(false);
    // A fresh section/filter starts at page one, including any live refresh
    // that overlaps its initial read.
    loadedPages.current = 1;
    let active = true;
    loadCustomers().catch((error) => {
      if (active) onNotice({ kind: 'error', text: dashboardErrorText(error) });
    });
    return () => {
      active = false;
    };
  }, [activeSection, canRead, loadCustomers, onNotice]);

  useDebtRealtime({
    activeSection,
    canRead,
    debtSection,
    openLedgerId,
    loadCustomers: refreshList,
    refreshLedger,
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

  async function refreshOpenLedger(saved?: ConfirmedLedgerWrite) {
    if (saved && ledger?.customer.id === saved.customerId) {
      const confirmed = applyConfirmedLedgerWrite(ledger, saved);
      if (confirmed !== ledger) {
        setLedger((current) => applyConfirmedLedgerWrite(current, saved));
        // The write is already committed. Summary refresh failure must not invite resubmission.
        void refreshAfterMutation().catch(() =>
          onNotice({
            kind: 'error',
            text: uiText(
              'تم حفظ المعاملة. تعذر تحديث الإجماليات مؤقتًا؛ أعد تحديث العرض دون تكرار المعاملة.',
            ),
          }),
        );
        return;
      }
    }
    try {
      if (ledger) await Promise.all([refreshCustomer(ledger.customer.id), loadLedger(ledger.customer.id)]);
    } catch (error) {
      if (!saved) throw error;
      onNotice({
        kind: 'error',
        text: uiText('تم حفظ المعاملة. تعذر تحديث الإجماليات مؤقتًا؛ أعد تحديث العرض دون تكرار المعاملة.'),
      });
    }
  }

  async function reviewZero(customer: Customer) {
    if (debtSection !== 'customers' || !customer.zeroReview?.pending) return;
    try {
      await api.reviewCustomerZero(customer.id, customer.zeroReview.financialVersion);
    } catch (error) {
      onNotice({ kind: 'error', text: dashboardErrorText(error) });
      await refreshAfterMutation().catch(() => undefined);
      return;
    }
    onNotice({ kind: 'success', text: uiText('تمت مراجعة التصفير ونقل الكارت إلى مجموعة المسدد.') });
    try {
      await refreshAfterMutation();
    } catch {
      onNotice({ kind: 'success', text: uiText('تم حفظ المراجعة. ستعيد المزامنة تحديث العرض تلقائيًا.') });
    }
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
    closeLedger: async () => {
      if (!(await flushBeforeNavigation())) return;
      ledgerRequest.current++;
      setLedger(null);
    },
    query,
    setQuery,
    filter,
    setFilter,
    loading: loading || (canRead && activeSection === debtSection && settledListKey !== listKey),
    loadError,
    retryLoad: () => {
      setLoading(true);
      setLoadError(false);
      void loadCustomers().catch((error) => onNotice({ kind: 'error', text: dashboardErrorText(error) }));
    },
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
    refreshAfterMutation,
    reviewZero,
  };
}
