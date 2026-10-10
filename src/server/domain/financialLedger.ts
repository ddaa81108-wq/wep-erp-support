import type { AppDatabase } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';

const SECTIONS = new Set([
  'customer_debts',
  'company_debts',
  'libyan_deposits',
  'egyptian_deposits',
  'masraweya',
  'purchases',
  'treasury',
]);

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      occurredAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.occurredAt !== 'string' || !Number.isSafeInteger(parsed.id) || Number(parsed.id) <= 0)
      throw new Error('invalid');
    return { occurredAt: parsed.occurredAt, id: Number(parsed.id) };
  } catch {
    throw badRequest('INVALID_PAGE_CURSOR', 'مؤشر صفحة سجل الأستاذ غير صالح.');
  }
}

function encodeCursor(row: Record<string, unknown>) {
  return Buffer.from(
    JSON.stringify({ occurredAt: String(row.occurred_at), id: Number(row.id) }),
    'utf8',
  ).toString('base64url');
}

function searchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

export function listFinancialLedger(database: AppDatabase, organizationId: string, url: URL) {
  const cursor = decodeCursor(url.searchParams.get('before'));
  const section = url.searchParams.get('section')?.trim() ?? '';
  if (section && !SECTIONS.has(section))
    throw badRequest('INVALID_LEDGER_SECTION', 'قسم سجل الأستاذ غير صالح.');
  const currency = url.searchParams.get('currency')?.trim() ?? '';
  if (currency && currency !== 'LYD' && currency !== 'EGP')
    throw badRequest('INVALID_LEDGER_CURRENCY', 'عملة سجل الأستاذ غير صالحة.');
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length > 120) throw badRequest('INVALID_LEDGER_QUERY', 'نص البحث أطول من الحد المسموح.');

  const where = ['f.organization_id=?', 'f.amount_units<>0'];
  const parameters: Array<string | number> = [organizationId];
  if (cursor) {
    where.push('(f.occurred_at<? OR (f.occurred_at=? AND f.id<?))');
    parameters.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }
  if (section) {
    where.push('f.section_key=?');
    parameters.push(section);
  }
  if (currency) {
    where.push('f.currency=?');
    parameters.push(currency);
  }
  if (query) {
    where.push(`(
      f.counterparty_name LIKE ? ESCAPE '\\' OR f.description LIKE ? ESCAPE '\\'
      OR f.reference_no LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
    )`);
    const pattern = searchPattern(query);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  const rows = database
    .prepare(`
      SELECT f.*,u.display_name AS actor_name,u.username AS actor_username
      FROM financial_ledger_entries f
      LEFT JOIN users u ON u.id=f.actor_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.occurred_at DESC,f.id DESC LIMIT 101
    `)
    .all(...parameters) as Record<string, unknown>[];
  const hasMore = rows.length > 100;
  const page = hasMore ? rows.slice(0, 100) : rows;
  const totals = page.reduce<{ LYD: number; EGP: number }>(
    (result, row) => {
      const currencyKey = String(row.currency) as 'LYD' | 'EGP';
      result[currencyKey] += Number(row.effect_units);
      return result;
    },
    { LYD: 0, EGP: 0 },
  );
  return {
    items: page.map((row) => ({
      id: Number(row.id),
      sourceKind: String(row.source_kind),
      sourceId: String(row.source_id),
      sectionKey: String(row.section_key),
      entryKind: String(row.entry_kind),
      counterpartyName: String(row.counterparty_name),
      description: String(row.description),
      referenceNo: String(row.reference_no),
      currency: String(row.currency),
      amountUnits: Number(row.amount_units),
      effectUnits: Number(row.effect_units),
      actorName: row.actor_name ? String(row.actor_name) : 'النظام',
      actorUsername: row.actor_username ? String(row.actor_username) : null,
      occurredAt: String(row.occurred_at),
      sourceStatus: String(row.source_status),
      updatedAt: String(row.updated_at),
    })),
    pageTotals: totals,
    nextBefore: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
}
