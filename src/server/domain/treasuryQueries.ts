import type { AppDatabase } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';
import {
  egyptianConversion,
  ensureCashAccount,
  purchasesBalance,
  safeUnits,
  sectionBalance,
} from './treasurySupport.ts';

export function treasuryDashboard(database: AppDatabase, organizationId: string) {
  const cash = ensureCashAccount(database, organizationId);
  const customers = sectionBalance(database, organizationId, 'customer_debts');
  const companies = sectionBalance(database, organizationId, 'company_debts');
  const libyanDeposits = sectionBalance(database, organizationId, 'libyan_deposits');
  const egyptianDeposits = sectionBalance(database, organizationId, 'egyptian_deposits');
  const purchases = purchasesBalance(database, organizationId);
  const receivablesUnits = safeUnits(BigInt(customers) + BigInt(companies), 'إجمالي الديون لنا');
  const liabilitiesUnits = safeUnits(BigInt(purchases) + BigInt(libyanDeposits), 'إجمالي الديون علينا');
  const activeCashUnits = Number(cash.balance_units);
  const egyptian = egyptianConversion(database, organizationId, egyptianDeposits);
  const netUnits =
    egyptian.convertedUnits === null
      ? null
      : safeUnits(
          BigInt(receivablesUnits) +
            BigInt(activeCashUnits) +
            BigInt(egyptian.convertedUnits) -
            BigInt(liabilitiesUnits),
          'صافي الخزينة',
        );
  return {
    currency: 'LYD' as const,
    receivablesUnits,
    liabilitiesUnits,
    activeCashUnits,
    egyptianSourceUnits: egyptianDeposits,
    egyptianConvertedUnits: egyptian.convertedUnits,
    egyptianRate: egyptian.rate,
    egyptianRateUpdatedAt: egyptian.rateUpdatedAt,
    netUnits,
    cashVersion: Number(cash.version),
    sources: { customers, companies, purchases, libyanDeposits, egyptianDeposits },
  };
}

export function treasuryCashLedger(database: AppDatabase, organizationId: string, url: URL) {
  const requested = url.searchParams.get('before');
  const before = requested ? Number(requested) : null;
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) {
    throw badRequest('INVALID_PAGE_CURSOR', 'مؤشر الصفحة غير صالح.');
  }
  const rows = database
    .prepare(
      `
    SELECT e.*,u.display_name AS actor_name,u.is_owner AS actor_is_owner
    FROM treasury_cash_entries e JOIN users u ON u.id=e.actor_user_id
    WHERE e.organization_id=? AND (? IS NULL OR e.sequence<?)
    ORDER BY e.sequence DESC LIMIT 101
  `,
    )
    .all(organizationId, before, before) as Record<string, unknown>[];
  const hasMore = rows.length > 100;
  const page = hasMore ? rows.slice(0, 100) : rows;
  const nextBefore = hasMore ? Number(page[page.length - 1]?.sequence ?? 0) : null;
  return {
    items: page.reverse().map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      direction: String(row.direction),
      amountUnits: Number(row.amount_units),
      description: String(row.description),
      balanceBeforeUnits: Number(row.balance_before_units),
      balanceAfterUnits: Number(row.balance_after_units),
      actorName: String(row.actor_name),
      actorIsOwner: Number(row.actor_is_owner) === 1,
      createdAt: String(row.created_at),
    })),
    nextBefore,
  };
}
