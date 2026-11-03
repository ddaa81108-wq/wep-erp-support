import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { badRequest, conflict, forbidden } from '../http/errors.ts';
import { customerAccount } from './customerAccountRepository.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';
import {
  assertAccountIsEditable,
  assertExpectedVersion,
  audit,
  emitEvent,
  readIdempotent,
  rememberIdempotent,
  validateRequestId,
  type OperationResult,
} from './customerTransactionSupport.ts';

/** Remove the account from active operation, retaining its financial evidence. */
export function deleteCustomerAccount(
  db: AppDatabase,
  actor: AuthenticatedUser,
  id: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind,
): OperationResult {
  if (actor.role !== 'admin') throw forbidden('accounts.delete');
  const requestId = validateRequestId(input.requestId);
  const profile = partyProfile(kind);
  const scope = `${profile.entity}:${id}:delete`;
  return inImmediateTransaction(db, () => {
    const replay = readIdempotent(db, actor.id, scope, requestId, input);
    if (replay) return { ...replay, replayed: true };
    const account = customerAccount(db, id, actor.organizationId, kind);
    assertAccountIsEditable(account);
    const version = assertExpectedVersion(account, input);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500)
      throw badRequest('ACCOUNT_DELETE_REASON_REQUIRED', 'اكتب سبب حذف الكارت من 5 إلى 500 حرف.');
    if (
      input.confirmedName !== account.name ||
      input.confirmedBalanceUnits !== account.currentBalanceUnits ||
      input.confirmed !== true
    )
      throw conflict(
        'ACCOUNT_DELETE_CONFIRMATION_CHANGED',
        'اكتب اسم الكارت وأكد رصيده وأثر حذفه بعد مراجعة أحدث بياناته.',
      );
    const linked = db
      .prepare(
        `SELECT 1 FROM collection_submissions WHERE customer_id=? AND (status='pending' OR (status='approved' AND cash_received_at IS NULL))
      UNION ALL SELECT 1 FROM collection_unlinked_receipts WHERE linked_customer_id=? AND (status='pending' OR (status='approved' AND cash_received_at IS NULL)) LIMIT 1`,
      )
      .get(id, id);
    if (linked)
      throw conflict(
        'ACCOUNT_HAS_UNSETTLED_COLLECTIONS',
        'راجع الاستلامات المعلقة وأكد النقدية غير المستلمة قبل حذف هذا الكارت.',
      );
    const deletedAt = nowIso();
    const assignments = db
      .prepare("SELECT id FROM debt_assignments WHERE customer_id=? AND status='active'")
      .all(id);
    db.prepare(
      "UPDATE debt_assignments SET status='cancelled',cancelled_at=? WHERE customer_id=? AND status='active'",
    ).run(deletedAt, id);
    db.prepare(
      'UPDATE customers SET deleted_at=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND deleted_at IS NULL',
    ).run(deletedAt, deletedAt, id, actor.organizationId, version);
    audit(db, actor.id, actor.organizationId, `${profile.entity}.delete`, profile.entity, id, correlationId, {
      subjectName: account.name,
      subjectSection: profile.sectionKey,
      reason,
      balanceUnits: account.currentBalanceUnits,
      previousVersion: version,
      cancelledAssignments: assignments.map((row) => row.id),
      historyRetained: true,
    });
    const eventSequences = [
      emitEvent(db, `${profile.event}.changed`, id, actor.id, actor.organizationId, {
        action: 'deleted',
        version: version + 1,
      }),
    ];
    if (assignments.length)
      eventSequences.push(
        emitEvent(db, 'collection.changed', id, actor.id, actor.organizationId, {
          action: 'account_deleted',
        }),
      );
    const result = {
      status: 200,
      body: { customerId: id, deleted: true, deletedAt, previousBalanceUnits: account.currentBalanceUnits },
      eventSequences,
    };
    rememberIdempotent(db, actor.id, scope, requestId, result, input);
    return result;
  });
}
