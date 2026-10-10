import { badRequest } from '../http/errors.ts';

export function pageLimit(value: string | null, fallback: number) {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw badRequest('INVALID_PAGE_LIMIT', 'حجم الصفحة غير صالح.');
  return Math.min(200, Math.max(20, parsed));
}
