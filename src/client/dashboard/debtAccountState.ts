import type { Customer, Ledger, ConfirmedLedgerWrite } from '../api.ts';
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
  if (next.customer.version < current.customer.version) return current;
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

/** Apply a committed server response only when it bridges exactly one known version. */
export function applyConfirmedLedgerWrite(current: Ledger | null, saved: ConfirmedLedgerWrite) {
  if (!current || current.customer.id !== saved.customerId) return current;
  if (saved.customerVersion !== current.customer.version + 1) return current;
  const existing = current.items.some(item => item.id === saved.transaction.id);
  // A correction outside the loaded page needs an authoritative page-opening balance.
  if (!existing && saved.transaction.sequence < current.customer.nextSequence) return current;
  if (!existing && saved.transaction.sequence !== current.customer.nextSequence) return current;
  const items = existing
    ? current.items.map(item => item.id === saved.transaction.id ? saved.transaction : item)
    : [...current.items, saved.transaction];
  return {
    ...current,
    items,
    totalItems: current.totalItems + (existing ? 0 : 1),
    customer: {
      ...current.customer,
      version: saved.customerVersion,
      balanceUnits: saved.balanceUnits,
      nextSequence: Math.max(current.customer.nextSequence, saved.transaction.sequence + 1),
    },
  };
}
