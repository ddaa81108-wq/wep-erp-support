import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { audit, emit, monthRemaining, notifyEmployee, requireAdmin } from './collectionPayroll.ts';

function nextPeriod(period: string) {
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Reverse only the payroll effect. Preserve the original entry and confirmation. */
export function cancelCollectionPayrollEntry(db: AppDatabase, actor: AuthenticatedUser, entryId: string, correlationId: string) {
  requireAdmin(actor);
  return inImmediateTransaction(db, () => {
    const row = db.prepare(`SELECT e.*,u.display_name AS employee_name FROM collection_payroll_entries e
      JOIN users u ON u.id=e.employee_user_id WHERE e.id=? AND e.organization_id=?`)
      .get(entryId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('payroll_entry');
    if (row.cancelled_at) return { id: entryId, cancelledAt: String(row.cancelled_at), replayed: true, eventSequences: [] };
    const cancelledAt = nowIso();
    db.prepare('UPDATE collection_payroll_entries SET cancelled_at=?,cancelled_by_user_id=? WHERE id=? AND organization_id=? AND cancelled_at IS NULL')
      .run(cancelledAt, actor.id, entryId, actor.organizationId);

    // A previous month's correction must also repair any already-created carry chain.
    let month = db.prepare('SELECT * FROM collection_payroll_months WHERE id=?').get(String(row.month_id)) as Record<string, unknown>;
    const following = db.prepare(`SELECT * FROM collection_payroll_months WHERE organization_id=? AND employee_user_id=?
      AND period_key>? ORDER BY period_key`).all(actor.organizationId, String(row.employee_user_id), String(month.period_key)) as Record<string, unknown>[];
    for (const next of following) {
      if (String(next.period_key) !== nextPeriod(String(month.period_key))) break;
      const carry = monthRemaining(db, month);
      db.prepare('UPDATE collection_payroll_months SET opening_carry_units=? WHERE id=?').run(carry, String(next.id));
      month = { ...next, opening_carry_units: carry };
    }
    const details = {
      employeeId: String(row.employee_user_id), employeeName: String(row.employee_name), subjectName: String(row.employee_name),
      subjectSection: 'collections', payrollKind: String(row.entry_kind), amountUnits: Number(row.amount_units),
      reason: String(row.reason), confirmedAt: row.confirmed_at, cancelledAt,
    };
    audit(db, actor, 'collection.payroll.entry.cancel', entryId, correlationId, details);
    notifyEmployee(db, actor, String(row.employee_user_id), 'collection.payroll.entry.cancel', entryId, details);
    return { id: entryId, cancelledAt, eventSequences: [emit(db, actor, String(row.employee_user_id), 'payroll_entry_cancelled')] };
  });
}
