import type { AppDatabase } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';
import { EFFECTIVE_CASH_CTE } from './treasuryCashView.ts';
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
  const effective = url.searchParams.get('view') === 'effective';
  const effectiveStatement = effective
    ? database.prepare(`${EFFECTIVE_CASH_CTE}, positioned AS (
    SELECT current_entries.*,SUM(CASE shown_direction WHEN 'in' THEN shown_amount ELSE -shown_amount END)
      OVER(ORDER BY sequence ROWS UNBOUNDED PRECEDING) AS shown_after FROM current_entries
  ) SELECT e.*,u.display_name AS actor_name,u.is_owner AS actor_is_owner
    FROM positioned e JOIN users u ON u.id=e.actor_user_id
    WHERE (? IS NULL OR e.sequence<?) ORDER BY e.sequence DESC LIMIT 101`)
    : null;
  effectiveStatement?.setReadBigInts(true);
  const rows = effectiveStatement
    ? (effectiveStatement.all(organizationId, before, before) as Record<string, unknown>[])
    : (database
        .prepare(
          `
    SELECT e.*,u.display_name AS actor_name,u.is_owner AS actor_is_owner,
      c.revision AS correction_revision,c.direction AS corrected_direction,c.amount_units AS corrected_amount,
      c.description AS corrected_description,c.reason AS correction_reason,c.created_at AS corrected_at,
      reviewer.display_name AS corrected_by,
      original.id AS correction_of_id,original.sequence AS correction_of_sequence
    FROM treasury_cash_entries e JOIN users u ON u.id=e.actor_user_id
    LEFT JOIN treasury_cash_corrections c ON c.organization_id=e.organization_id AND c.entry_id=e.id
      AND c.revision=(SELECT MAX(latest.revision) FROM treasury_cash_corrections latest WHERE latest.organization_id=e.organization_id AND latest.entry_id=e.id)
    LEFT JOIN users reviewer ON reviewer.id=c.actor_user_id
    LEFT JOIN treasury_cash_corrections adjustment ON adjustment.adjustment_entry_id=e.id
    LEFT JOIN treasury_cash_entries original ON original.id=adjustment.entry_id
    WHERE e.organization_id=? AND (? IS NULL OR e.sequence<?)
    ORDER BY e.sequence DESC LIMIT 101
  `,
        )
        .all(organizationId, before, before) as Record<string, unknown>[]);
  const hasMore = rows.length > 100;
  const page = hasMore ? rows.slice(0, 100) : rows;
  const nextBefore = hasMore ? Number(page[page.length - 1]?.sequence ?? 0) : null;
  return {
    items: page.reverse().map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      direction: String(effective ? row.shown_direction : row.direction),
      amountUnits: Number(effective ? row.shown_amount : row.amount_units),
      description: String(effective ? row.shown_description : row.description),
      balanceBeforeUnits: effective
        ? safeUnits(
            BigInt(String(row.shown_after)) -
              BigInt(String(row.shown_amount)) * (row.shown_direction === 'in' ? 1n : -1n),
            'رصيد السجل',
          )
        : Number(row.balance_before_units),
      balanceAfterUnits: effective
        ? safeUnits(BigInt(String(row.shown_after)), 'رصيد السجل')
        : Number(row.balance_after_units),
      actorName: String(row.actor_name),
      actorIsOwner: Number(row.actor_is_owner) === 1,
      createdAt: String(row.created_at),
      correctionOf: row.correction_of_id
        ? { id: String(row.correction_of_id), sequence: Number(row.correction_of_sequence) }
        : null,
      correction: row.correction_revision
        ? {
            revision: Number(row.correction_revision),
            direction: String(row.corrected_direction),
            amountUnits: Number(row.corrected_amount),
            description: String(row.corrected_description),
            reason: String(row.correction_reason),
            correctedAt: String(row.corrected_at),
            correctedBy: String(row.corrected_by),
          }
        : null,
    })),
    nextBefore,
  };
}
