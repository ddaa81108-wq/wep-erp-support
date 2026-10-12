import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { audit, emitEvent } from './customerTransactionSupport.ts';

export function zeroReviewSnapshot(row: Record<string, unknown>) {
  if (row.section_key !== 'customer_debts' || row.system_link_key) return undefined;
  return {
    pending: Number(row.zero_review_pending) === 1,
    financialVersion: Number(row.zero_review_financial_version),
    reviewedAt: row.zero_reviewed_at ? String(row.zero_reviewed_at) : null,
    reviewedByName: row.zero_reviewed_by_name ? String(row.zero_reviewed_by_name) : null,
  };
}

export function reviewCustomerZero(database: AppDatabase, actor: AuthenticatedUser, customerId: string,
  input: Record<string, unknown>, correlationId: string) {
  if (actor.role !== 'admin') throw forbidden('customers.zero_review');
  const expected = input.expectedFinancialVersion;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) {
    throw badRequest('INVALID_REVIEW_VERSION', 'نسخة المراجعة غير صالحة. حدّث الكارت ثم أعد المحاولة.');
  }
  return inImmediateTransaction(database, () => {
    const row = database.prepare(`SELECT * FROM customers WHERE id=? AND organization_id=?
      AND section_key='customer_debts' AND deleted_at IS NULL AND system_link_key IS NULL`)
      .get(customerId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('customer');
    if (Number(row.current_balance_units) !== 0 || Number(row.zero_review_financial_version) !== expected) {
      throw conflict('ZERO_REVIEW_CHANGED', 'تغيّر الكارت بعد عرضه. راجع آخر حركة قبل تأكيد المراجعة.');
    }
    if (Number(row.zero_review_pending) === 0 && row.zero_reviewed_at) {
      return { status: 200, body: { zeroReview: zeroReviewSnapshot(row), replayed: true } };
    }
    if (Number(row.zero_review_pending) !== 1) {
      throw conflict('ZERO_REVIEW_NOT_PENDING', 'هذا الكارت لا ينتظر مراجعة تصفير.');
    }
    const reviewedAt = nowIso();
    database.prepare(`UPDATE customers SET zero_review_pending=0,zero_reviewed_at=?,zero_reviewed_by=?,zero_reviewed_by_name=? WHERE id=?`)
      .run(reviewedAt, actor.id, actor.displayName, customerId);
    audit(database, actor.id, actor.organizationId, 'customer.zero_review', 'customer', customerId, correlationId,
      { financialVersion: expected, reviewedAt });
    const eventSequence = emitEvent(database, 'customer.changed', customerId, actor.id, actor.organizationId,
      { action: 'zero_reviewed', financialVersion: expected });
    return { status: 200, body: { zeroReview: {
      pending: false, financialVersion: Number(expected), reviewedAt, reviewedByName: actor.displayName,
    } }, eventSequence };
  });
}
