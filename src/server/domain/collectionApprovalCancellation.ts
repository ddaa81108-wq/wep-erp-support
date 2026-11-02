import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import { cancelCustomerTransaction } from './customers.ts';
import type { DebtPartyKind } from './customerProfiles.ts';
import {
  audit,
  emitEvent,
  readIdempotent,
  rememberIdempotent,
  validateRequestId,
} from './customerTransactionSupport.ts';

/** Reverse one intact collection posting atomically; never undo unrelated later transactions. */
export function cancelCollectionApproval(
  db: AppDatabase,
  actor: AuthenticatedUser,
  receiptId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: 'linked' | 'unlinked' = 'linked',
) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  const requestId = validateRequestId(input.requestId);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500)
    throw badRequest('CANCELLATION_REASON_REQUIRED', 'اكتب سبب إلغاء الاعتماد من 5 إلى 500 حرف.');
  const scope = `collections:${kind}:${receiptId}:cancel-approval`;
  const fingerprint = { reason, expectedTransactionId: input.expectedTransactionId };
  return inImmediateTransaction(db, () => {
    const replay = readIdempotent(db, actor.id, scope, requestId, fingerprint);
    if (replay) return { ...(replay.body as object), replayed: true, eventSequences: [] as number[] };
    const table = kind === 'linked' ? 'collection_submissions' : 'collection_unlinked_receipts';
    const customerColumn = kind === 'linked' ? 'customer_id' : 'linked_customer_id';
    const row = db
      .prepare(
        `SELECT r.*, c.id AS account_id,c.version AS account_version,c.section_key,c.current_balance_units,
      (SELECT id FROM customer_cycles WHERE customer_id=c.id AND status='active') AS active_cycle_id
      FROM ${table} r LEFT JOIN customers c ON c.id=r.${customerColumn}
      WHERE r.id=? AND ${kind === 'linked' ? 'c' : 'r'}.organization_id=?`,
      )
      .get(receiptId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('collection_receipt');
    if (row.cash_received_at)
      throw conflict(
        'COLLECTION_CASH_ALREADY_RECEIVED',
        'تم استلام نقدية هذه العملية؛ لا يمكن إلغاء اعتمادها بهذا الإجراء.',
      );
    if (!row.approved_transaction_id || row.approved_transaction_id !== input.expectedTransactionId)
      throw conflict(
        'COLLECTION_APPROVAL_CHANGED',
        'تغيّر الاستلام أو لم يُعتمد بعد. حدّث البيانات وراجع العملية.',
      );
    // A second administrator or a retry after a lost reply must not reverse twice.
    if (row.status === 'rejected') {
      const evidence = db
        .prepare(
          "SELECT 1 FROM audit_log WHERE organization_id=? AND entity_id=? AND action='collection.approval.cancel'",
        )
        .get(actor.organizationId, receiptId);
      const reversed = db
        .prepare("SELECT 1 FROM debt_transactions WHERE id=? AND transaction_status='reversed'")
        .get(String(row.approved_transaction_id));
      if (!evidence || !reversed)
        throw conflict('COLLECTION_POSTING_CHANGED', 'حالة العملية تحتاج مراجعة من سجل العميل.');
      return { id: receiptId, cancelled: true, replayed: true, eventSequences: [] as number[] };
    }
    if (row.status !== 'approved')
      throw conflict('SUBMISSION_NOT_APPROVED', 'لا يمكن إلغاء اعتماد عملية غير معتمدة.');
    const transaction = db
      .prepare('SELECT * FROM debt_transactions WHERE id=? AND customer_id=?')
      .get(String(row.approved_transaction_id), String(row.account_id)) as
      Record<string, unknown> | undefined;
    const entryType = kind === 'linked' ? 'payment' : row.entry_type;
    if (
      !transaction ||
      transaction.transaction_status !== 'posted' ||
      transaction.deleted_at !== null ||
      transaction.cycle_id !== row.active_cycle_id ||
      transaction.entry_type !== entryType ||
      transaction.amount_units !== row.amount_units ||
      transaction.currency !== 'LYD' ||
      transaction.conversion_rate_micros !== 1000000
    )
      throw conflict(
        'COLLECTION_POSTING_CHANGED',
        'حركة الاعتماد الأصلية عُدلت أو أُلغيت أو تغيرت دورتها؛ يلزم مراجعتها من سجل العميل.',
      );
    const partyKinds: Record<string, DebtPartyKind> = {
      customer_debts: 'customer',
      company_debts: 'company',
      libyan_deposits: 'depositLyd',
    };
    const partyKind = partyKinds[String(row.section_key)];
    if (!partyKind)
      throw conflict('COLLECTION_CURRENCY_MISMATCH', 'لا يمكن تصحيح استلام بعملة مختلفة بهذا الإجراء.');
    const reversed = cancelCustomerTransaction(
      db,
      actor,
      String(row.account_id),
      String(row.approved_transaction_id),
      {
        requestId: `collection-approval-cancel-${kind}-${receiptId}`,
        expectedVersion: Number(row.account_version),
        reason,
      },
      correlationId,
      partyKind,
    );
    // Existing rejected state plus the retained posting reference distinguishes a
    // cancelled approval from a receipt rejected before posting; evidence is retained.
    db.prepare(`UPDATE ${table} SET status='rejected',decision_note=? WHERE id=? AND status='approved'`).run(
      reason,
      receiptId,
    );
    audit(
      db,
      actor.id,
      actor.organizationId,
      'collection.approval.cancel',
      'collection_submission',
      receiptId,
      correlationId,
      {
        kind,
        reason,
        transactionId: row.approved_transaction_id,
        customerId: row.account_id,
        amountUnits: row.amount_units,
        previousBalanceUnits: row.current_balance_units,
        originalDecisionNote: row.decision_note,
        approvedAt: row.decided_at,
        approvedByUserId: row.decided_by_user_id,
        ...(reversed.body as object),
      },
    );
    const eventSequence = emitEvent(db, 'collection.changed', receiptId, actor.id, actor.organizationId, {
      action: 'approval_cancelled',
      customerId: row.account_id,
    });
    const body = { id: receiptId, cancelled: true, ...(reversed.body as object) };
    rememberIdempotent(db, actor.id, scope, requestId, { status: 200, body }, fingerprint);
    return {
      ...body,
      eventSequences: [reversed.eventSequence, eventSequence].filter(
        (value): value is number => typeof value === 'number',
      ),
    };
  });
}
