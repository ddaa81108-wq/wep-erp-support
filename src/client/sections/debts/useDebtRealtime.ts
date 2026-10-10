import { useEffect } from 'react';
import { api, type Customer } from '../../api.ts';
import type { DebtSection, MainSection } from './sectionConfig.ts';

type Props = {
  activeSection: MainSection;
  canRead: boolean;
  debtSection: DebtSection;
  openLedgerId: { current: string | null };
  fetchCustomer: (id: string) => Promise<Customer>;
  loadCustomers: () => Promise<void>;
  mergeCustomers: (snapshots: Customer[]) => void;
  refreshLedgerWhenIdle: (id: string) => void;
  onError: (error: unknown) => void;
};

const eventPrefixFor = (section: DebtSection) => {
  if (section === 'companies') return 'company';
  if (section === 'libyan-deposits') return 'libyan-deposit';
  if (section === 'egyptian-deposits') return 'egyptian-deposit';
  return 'customer';
};

export function useDebtRealtime({
  activeSection,
  canRead,
  debtSection,
  openLedgerId,
  fetchCustomer,
  loadCustomers,
  mergeCustomers,
  refreshLedgerWhenIdle,
  onError,
}: Props) {
  useEffect(() => {
    if (
      !canRead ||
      activeSection === 'settings' ||
      activeSection === 'collections' ||
      activeSection === 'masraweya' ||
      activeSection === 'purchases' ||
    activeSection === 'treasury'
    || activeSection === 'reports'
    )
      return;

    const cursorKey = 'abdo:last-event';
    const after = sessionStorage.getItem(cursorKey) ?? '0';
    const source = new EventSource(`/api/events?after=${encodeURIComponent(after)}`);
    const pendingIds = new Set<string>();
    const eventPrefix = eventPrefixFor(debtSection);
    let batchTimer: number | null = null;
    let polling = false;

    const flush = async () => {
      batchTimer = null;
      const ids = [...pendingIds];
      pendingIds.clear();
      if (ids.length === 0) return;
      try {
        const snapshots = await Promise.all(ids.map((id) => fetchCustomer(id)));
        mergeCustomers(snapshots);
        const ledgerId = openLedgerId.current;
        if (ledgerId && ids.includes(ledgerId)) refreshLedgerWhenIdle(ledgerId);
      } catch (error) {
        onError(error);
      }
    };

    const scheduleFlush = () => {
      if (pendingIds.size > 0 && batchTimer === null) batchTimer = window.setTimeout(() => void flush(), 250);
    };

    const refresh = (event: Event) => {
      const message = event as MessageEvent<string>;
      if (message.lastEventId) sessionStorage.setItem(cursorKey, message.lastEventId);
      try {
        const data = JSON.parse(message.data) as { aggregateId?: string };
        if (!data.aggregateId) return;
        pendingIds.add(data.aggregateId);
        scheduleFlush();
      } catch {
        // A later poll or full resync repairs a malformed realtime message.
      }
    };

    const fullResync = () => {
      void loadCustomers();
      const ledgerId = openLedgerId.current;
      if (ledgerId) refreshLedgerWhenIdle(ledgerId);
    };

    const pollChanges = async () => {
      if (polling) return;
      polling = true;
      try {
        const cursor = Math.max(0, Number(sessionStorage.getItem(cursorKey)) || 0);
        const result = await api.eventChanges(cursor);
        if (result.fullResync) fullResync();
        for (const change of result.events) {
          if (
            change.aggregateId &&
            (change.topic === `${eventPrefix}.changed` || change.topic === `${eventPrefix}.ledger.changed`)
          ) {
            pendingIds.add(change.aggregateId);
          }
        }
        scheduleFlush();
        if (result.latest > cursor) sessionStorage.setItem(cursorKey, String(result.latest));
      } catch {
        // EventSource keeps retrying; the next poll recovers missed changes.
      } finally {
        polling = false;
      }
    };

    const pollTimer = window.setInterval(() => void pollChanges(), 2_500);
    source.addEventListener(`${eventPrefix}.changed`, refresh);
    source.addEventListener(`${eventPrefix}.ledger.changed`, refresh);
    source.addEventListener('full_resync_required', fullResync);

    return () => {
      source.close();
      window.clearInterval(pollTimer);
      if (batchTimer !== null) window.clearTimeout(batchTimer);
    };
  }, [
    activeSection,
    canRead,
    debtSection,
    fetchCustomer,
    loadCustomers,
    mergeCustomers,
    onError,
    openLedgerId,
    refreshLedgerWhenIdle,
  ]);
}
