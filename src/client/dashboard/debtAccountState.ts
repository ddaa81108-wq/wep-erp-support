import type { Customer, Ledger } from '../api.ts';
import { orderCustomerCards } from '../sections/debts/debtSectionUtils.ts';

export function mergeCustomerSnapshots(current: Customer[], snapshots: Customer[]) {
  const changed = new Map(snapshots.map((item) => [item.id, item]));
  const merged = current.map((item) => changed.get(item.id) ?? item);
  const knownIds = new Set(current.map((item) => item.id));
  for (const snapshot of snapshots) if (!knownIds.has(snapshot.id)) merged.push(snapshot);
  return orderCustomerCards(merged);
}

export function appendCustomerPage(current: Customer[], page: Customer[]) {
  return orderCustomerCards([
    ...new Map([...current, ...page].map((item) => [item.id, item])).values(),
  ]);
}

export function prependOlderLedgerPage(current: Ledger | null, older: Ledger) {
  if (current?.customer.id !== older.customer.id) return current;
  return {
    ...older,
    items: [...older.items, ...current.items],
    totalItems: Math.max(older.totalItems, current.totalItems),
  };
}

export function mergeFreshLedger(current: Ledger | null, next: Ledger, customerId: string) {
  if (current?.customer.id !== customerId) return current;
  if (current.items.length <= next.items.length) return next;
  return {
    ...next,
    items: [
      ...new Map([...current.items, ...next.items].map((item) => [item.id, item])).values(),
    ].sort((left, right) => left.sequence - right.sequence),
    pageOpeningBalanceUnits: current.pageOpeningBalanceUnits,
    nextCursor: current.nextCursor,
  };
}
