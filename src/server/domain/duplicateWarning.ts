import { conflict } from '../http/errors.ts';
import { businessDayRange, currentBusinessDate } from './reports/businessDates.ts';

/** Advisory only; permissions, versions and idempotency are checked independently. */
export function warnDuplicate(input: Record<string, unknown>, matches: () => boolean) {
  if (input.checkDuplicate === true && input.allowDuplicate !== true && matches())
    throw conflict('DUPLICATE_SAME_WORKDAY', 'توجد معاملة مماثلة في نفس المكان خلال يوم العمل الحالي. هل تريد إضافتها مرة أخرى؟');
}

export function todayRange() {
  return businessDayRange(currentBusinessDate(), 'Africa/Tripoli');
}
