import { positiveRateMicros, convertedWholeUnits } from '../../../shared/moneyCalculation.ts';
import { ApiError, type Ledger, type LedgerItem } from '../../api.ts';

export type LedgerDraftKind = 'debt' | 'partial' | 'full';
export type LedgerCalculationMode = 'direct' | 'multiply' | 'divide';

export const ledgerFactor = new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 6 });
export const ledgerMoney = new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 });
export const ledgerDateFormat = new Intl.DateTimeFormat('ar-LY', {
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
});

export const ledgerErrorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. لم تُعتمد العملية.';

export const ledgerItemKind = (item: LedgerItem): LedgerDraftKind =>
  item.type === 'debt' ? 'debt' : item.paymentMode === 'full' ? 'full' : 'partial';

export function ledgerBalanceBeforeDraft(ledger: Ledger, editing: LedgerItem | null) {
  return editing
    ? ledger.customer.balanceUnits - (editing.type === 'debt' ? editing.amountUnits : -editing.amountUnits)
    : ledger.customer.balanceUnits;
}

export function ledgerDraftResult(
  kind: LedgerDraftKind,
  mode: LedgerCalculationMode,
  value: string,
  factor: string,
  balanceBefore: number,
) {
  if (kind === 'full') return Math.max(0, balanceBefore);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return 0;
  if (mode === 'direct') return number;
  const micros = positiveRateMicros(factor);
  return micros === null ? 0 : (convertedWholeUnits(number, micros, mode, 'floor') ?? 0);
}

export function ledgerBalances(ledger: Ledger) {
  let running = ledger.pageOpeningBalanceUnits;
  const values = new Map<string, number>();
  [...ledger.items]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((item) => {
      if (item.status === 'posted') running += item.type === 'debt' ? item.amountUnits : -item.amountUnits;
      values.set(item.id, running);
    });
  return values;
}
