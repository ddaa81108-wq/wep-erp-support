import type { PurchaseEntry } from '../../apiTypes/purchases.ts';

const safe = (value: bigint) => value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
  ? Number(value) : null;

/** Loaded entries are a contiguous suffix, oldest first. Anchor at the server's
 * full closing balance so loading an older page never resets the carry. */
export function purchaseRunningBalances(entries: readonly Pick<PurchaseEntry, 'id' | 'resultUnits' | 'paidUnits'>[], closingBalance: number) {
  const balances = new Map<string, { before: number | null; after: number | null }>();
  if (!Number.isSafeInteger(closingBalance)) return balances;
  let balance = BigInt(closingBalance);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!Number.isSafeInteger(entry.resultUnits) || !Number.isSafeInteger(entry.paidUnits)) return new Map<string, { before: number | null; after: number | null }>();
    const before = balance - BigInt(entry.resultUnits) + BigInt(entry.paidUnits);
    balances.set(entry.id, { before: safe(before), after: safe(balance) });
    balance = before;
  }
  return balances;
}

export function purchasePreviewBalance(before: number | null, delta: number) {
  return before !== null && Number.isSafeInteger(before) && Number.isSafeInteger(delta)
    ? safe(BigInt(before) + BigInt(delta)) : null;
}
