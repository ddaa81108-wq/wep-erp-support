import { badRequest } from '../http/errors.ts';
import { hasValidLeadingCalendarDate } from './dates.ts';

export type CalculationMode = 'direct' | 'multiply' | 'divide';
export const MAX_PRECISE_WHOLE_UNITS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000);

export function asPositiveWholeUnits(value: unknown, field: string) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > MAX_PRECISE_WHOLE_UNITS) {
    throw badRequest('INVALID_AMOUNT', 'القيمة المالية يجب أن تكون رقمًا صحيحًا موجبًا بدون كسور.', { field });
  }
  return numeric;
}

/**
 * يطابق منطق customerAccounts.ts في المصدر: الناتج يُقتطع إلى عدد صحيح بـMath.floor.
 */
export function calculateCustomerAmount(
  input: unknown,
  modeValue: unknown,
  factorValue: unknown,
) {
  const inputNumber = asPositiveWholeUnits(input, 'inputValue');
  const mode = (modeValue ?? 'direct') as CalculationMode;
  if (!['direct', 'multiply', 'divide'].includes(mode)) {
    throw badRequest('INVALID_CALCULATION_MODE', 'طريقة الحساب غير معروفة.');
  }
  let factor: number | undefined;
  if (mode !== 'direct') factor = asPositiveWholeUnits(factorValue, 'factor');
  const raw = mode === 'direct'
    ? inputNumber
    : mode === 'multiply'
      ? inputNumber * Number(factor)
      : inputNumber / Number(factor);
  const amountUnits = Math.floor(raw);
  if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
    throw badRequest('INVALID_CALCULATION_RESULT', 'ناتج العملية المالية غير صالح.');
  }
  const inputMicros = inputNumber * 1_000_000;
  const factorMicros = factor === undefined ? null : factor * 1_000_000;
  if (!Number.isSafeInteger(inputMicros) || (factorMicros !== null && !Number.isSafeInteger(factorMicros))) {
    throw badRequest('INVALID_AMOUNT_PRECISION', 'قيمة الإدخال أكبر من الدقة الآمنة.');
  }
  return {
    mode,
    inputMicros,
    factorMicros,
    amountUnits,
  };
}

export function normalizePartyName(value: unknown) {
  if (typeof value !== 'string') {
    throw badRequest('CUSTOMER_NAME_REQUIRED', 'اسم العميل مطلوب.');
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 160) {
    throw badRequest('INVALID_CUSTOMER_NAME', 'اسم العميل يجب أن يكون بين حرفين و160 حرفًا.');
  }
  const normalized = name
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, normalized };
}

export function validateTransactionDate(value: unknown) {
  const date = typeof value === 'string' && value ? value : new Date().toISOString();
  if (!hasValidLeadingCalendarDate(date) || !Number.isFinite(new Date(date).getTime())) {
    throw badRequest('INVALID_TRANSACTION_DATE', 'تاريخ الحركة غير صالح.');
  }
  return new Date(date).toISOString();
}
