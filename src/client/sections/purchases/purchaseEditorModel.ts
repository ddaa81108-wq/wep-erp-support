import { positiveRateMicros, convertedWholeUnits } from '../../../shared/moneyCalculation.ts';
import { ApiError, type PurchaseEntry, type PurchaseEntryInput } from '../../api.ts';

export const purchaseNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const PURCHASE_TYPES = [
  ['vodafone_cash', 'فودافون'],
  ['kafr_el_sheikh', 'كفر الشيخ'],
  ['cairo', 'القاهرة'],
  ['mansoura', 'المنصورة'],
  ['fawry', 'فوري'],
  ['banks', 'بنوك'],
] as const;

export type PurchaseDraft = {
  itemCode: string;
  itemLabel: string;
  value: string;
  mode: 'multiply' | 'divide';
  rate: string;
  paid: string;
  consumed: string;
};

export const blankPurchaseDraft = (): PurchaseDraft => ({
  itemCode: 'vodafone_cash',
  itemLabel: 'فودافون كاش',
  value: '',
  mode: 'divide',
  rate: '',
  paid: '',
  consumed: '',
});

export const purchaseDraftFromEntry = (entry: PurchaseEntry): PurchaseDraft => ({
  itemCode: entry.itemCode,
  itemLabel: entry.itemLabel,
  value: String(entry.egpValueUnits),
  mode: entry.calculationMode,
  rate: String(entry.exchangeRate),
  paid: String(entry.paidUnits),
  consumed: String(entry.vodafoneConsumedUnits),
});

export const integerInput = (value: string) => value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');

export function decimalInput(value: string) {
  const clean = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = clean.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 6)}` : whole;
}

export function updatePurchaseDraft(
  draft: PurchaseDraft,
  field: keyof PurchaseDraft,
  value: string,
): PurchaseDraft {
  return {
    ...draft,
    [field]:
      field === 'rate'
        ? decimalInput(value)
        : field === 'value' || field === 'paid' || field === 'consumed'
          ? integerInput(value)
          : value,
  };
}

export function choosePurchaseType(draft: PurchaseDraft, itemCode: string, itemLabel: string): PurchaseDraft {
  return {
    ...draft,
    itemCode,
    itemLabel,
  };
}

export function purchaseDraftTotals(draft: PurchaseDraft) {
  const value = Number(draft.value || 0);
  const rate = positiveRateMicros(draft.rate);
  const result = rate === null ? 0 : (convertedWholeUnits(value, rate, draft.mode, 'nearest') ?? 0);
  return { value, result, remaining: result - Number(draft.paid || 0) };
}

export function purchaseDraftIsBlank(draft: PurchaseDraft) {
  return !draft.value && !draft.rate && !draft.paid && !draft.consumed;
}

export function purchaseDraftIsConsumptionOnly(draft: PurchaseDraft) {
  return !draft.value
    && !draft.rate
    && !draft.paid
    && Number(draft.consumed || 0) > 0;
}

export function purchaseDraftIsStandalone(draft: PurchaseDraft) {
  return !draft.value
    && !draft.rate
    && (Number(draft.paid || 0) > 0 || Number(draft.consumed || 0) > 0);
}

export function purchaseDraftError(draft: PurchaseDraft) {
  if (purchaseDraftIsStandalone(draft)) return null;
  return !draft.value || !draft.rate || !draft.itemLabel.trim() ? 'أكمل النوع والقيمة وسعر الصرف.' : null;
}

export function purchaseEntryInput(
  draft: PurchaseDraft,
  requestId: string,
  expectedDayVersion: number,
): PurchaseEntryInput {
  const { value } = purchaseDraftTotals(draft);
  const standalone = purchaseDraftIsStandalone(draft);
  const paid = Number(draft.paid || 0);
  const consumed = Number(draft.consumed || 0);
  const standaloneLabel = paid > 0 && consumed > 0
    ? 'تسديد واستهلاك فودافون'
    : paid > 0
      ? 'تسديد'
      : 'مستهلك فودافون';
  return {
    requestId,
    expectedDayVersion,
    itemCode: standalone ? 'standalone_adjustment' : draft.itemCode,
    itemLabel: standalone ? standaloneLabel : draft.itemLabel,
    egpValueUnits: standalone ? 0 : value,
    calculationMode: standalone ? 'divide' : draft.mode,
    exchangeRate: standalone ? '1' : draft.rate,
    paidUnits: paid,
    vodafoneConsumedUnits: consumed,
  };
}

export const purchaseErrorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية.';
