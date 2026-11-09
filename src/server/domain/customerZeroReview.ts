import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { audit, emitEvent } from './customerTransactionSupport.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';

const REVIEWED_SECTIONS = new Set(['customer_debts', 'company_debts', 'libyan_deposits', 'egyptian_deposits']);
export const SETTLED_ZERO_RANK_EXPRESSION =
  'CASE WHEN current_balance_units=0 AND (zero_review_pending=0 OR system_link_key IS NOT NULL) THEN 1 ELSE 0 END';

export function settledZeroRankSql(alias: string) {
  return SETTLED_ZERO_RANK_EXPRESSION
    .replaceAll('current_balance_units', `${alias}.current_balance_units`)
    .replaceAll('zero_review_pending', `${alias}.zero_review_pending`)
    .replaceAll('system_link_key', `${alias}.system_link_key`);
}

const sectionWritePermission = {
  company: 'companies.write',
  depositLyd: 'libyan_deposits.write',
  depositEgp: 'egyptian_deposits.write',
} as const;

export function zeroReviewSnapshot(row: Record<string, unknown>) {
  if (!REVIEWED_SECTIONS.has(String(row.section_key)) || row.system_link_key) return undefined;
  return {
    pending: Number(row.zero_review_pending) === 1,
    financialVersion: Number(row.zero_review_financial_version),
    reviewedAt: row.zero_reviewed_at ? String(row.zero_reviewed_at) : null,
    reviewedByName: row.zero_reviewed_by_name ? String(row.zero_reviewed_by_name) : null,
  };
}

function assertCanReview(actor: AuthenticatedUser, kind: DebtPartyKind) {
  if (kind === 'customer') {
    if (actor.role !== 'admin') throw forbidden('customers.zero_review');
    return;
  }
  const permission = sectionWritePermission[kind];
  if (actor.role !== 'admin' && !actor.permissions.has(permission)) throw forbidden(permission);
}

export function reviewCustomerZero(database: AppDatabase, actor: AuthenticatedUser, customerId: string,
  input: Record<string, unknown>, correlationId: string, kind: DebtPartyKind = 'customer') {
  assertCanReview(actor, kind);
  const profile = partyProfile(kind);
  const expected = input.expectedFinancialVersion;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) {
    throw badRequest('INVALID_REVIEW_VERSION', 'نسخة المراجعة غير صالحة. حدّث الكارت ثم أعد المحاولة.');
  }
  return inImmediateTransaction(database, () => {
    const row = database.prepare(`SELECT * FROM customers WHERE id=? AND organization_id=?
      AND section_key=? AND deleted_at IS NULL AND system_link_key IS NULL`)
      .get(customerId, actor.organizationId, profile.sectionKey) as Record<string, unknown> | undefined;
    if (!row) throw notFound(profile.missing);
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
    const updated = database.prepare(`UPDATE customers SET zero_review_pending=0,zero_reviewed_at=?,zero_reviewed_by=?,zero_reviewed_by_name=?
      WHERE id=? AND organization_id=? AND section_key=? AND deleted_at IS NULL AND system_link_key IS NULL
        AND current_balance_units=0 AND zero_review_financial_version=? AND zero_review_pending=1`)
      .run(reviewedAt, actor.id, actor.displayName, customerId, actor.organizationId, profile.sectionKey, expected);
    if (Number(updated.changes) !== 1) {
      throw conflict('ZERO_REVIEW_CHANGED', 'تغيّر الكارت بعد عرضه. راجع آخر حركة قبل تأكيد المراجعة.');
    }
    audit(database, actor.id, actor.organizationId, `${profile.entity}.zero_review`, profile.entity, customerId, correlationId,
      { financialVersion: expected, reviewedAt });
    const eventSequence = emitEvent(database, `${profile.event}.changed`, customerId, actor.id, actor.organizationId,
      { action: 'zero_reviewed', financialVersion: expected });
    return { status: 200, body: { zeroReview: {
      pending: false, financialVersion: Number(expected), reviewedAt, reviewedByName: actor.displayName,
    } }, eventSequence };
  });
}
