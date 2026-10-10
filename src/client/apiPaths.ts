import type { CustomerListOptions } from './apiTypes.ts';

export function customerListPath(path: string, options: CustomerListOptions = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 100));
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.query?.trim()) params.set('q', options.query.trim());
  if (options.filter) params.set('filter', options.filter);
  return `${path}?${params.toString()}`;
}

export function ledgerPath(path: string, before?: string | null) {
  return `${path}?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`;
}

export function financialLedgerPath(options: {
  before?: string | null;
  section?: string;
  currency?: '' | 'LYD' | 'EGP';
  query?: string;
} = {}) {
  const params = new URLSearchParams();
  if (options.before) params.set('before', options.before);
  if (options.section) params.set('section', options.section);
  if (options.currency) params.set('currency', options.currency);
  if (options.query?.trim()) params.set('q', options.query.trim());
  return `/api/financial-ledger${params.size ? `?${params.toString()}` : ''}`;
}
