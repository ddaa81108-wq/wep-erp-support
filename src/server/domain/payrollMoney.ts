import type { AppDatabase } from '../db/database.ts';
import { safeBalance } from './customerTransactionSupport.ts';

/** Sum with exact integers before converting to the numeric API contract. */
export function payrollTotals(db: AppDatabase, monthId: string) {
  const statement = db.prepare(`SELECT entry_kind,amount_units FROM collection_payroll_entries
    WHERE month_id=? AND cancelled_at IS NULL`);
  statement.setReadBigInts(true);
  let withdrawals = 0n, commissions = 0n;
  for (const row of statement.iterate(monthId)) {
    if (row.entry_kind === 'withdrawal') withdrawals += row.amount_units as bigint;
    else commissions += row.amount_units as bigint;
  }
  return { withdrawalsUnits: safeBalance(withdrawals), commissionsUnits: safeBalance(commissions) };
}

export function payrollRemaining(month: Record<string, unknown>, totals: ReturnType<typeof payrollTotals>) {
  return safeBalance(BigInt(month.base_salary_units as number) + BigInt(month.opening_carry_units as number)
    + BigInt(totals.commissionsUnits) - BigInt(totals.withdrawalsUnits));
}
