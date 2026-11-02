import type { AppDatabase } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { badRequest, forbidden } from '../http/errors.ts';

const receipts = `WITH receipts AS (
  SELECT s.id,'linked' AS kind,s.assignment_id AS assignmentId,s.customer_id AS customerId,
    c.organization_id AS organizationId,s.batch_id AS batchId,b.status AS batchStatus,
    s.business_date AS businessDate,s.collector_user_id AS collectorUserId,u.display_name AS collectorName,
    c.name AS customerName,c.phone,s.mode,s.amount_units AS amountUnits,s.status,s.submitted_at AS submittedAt,
    s.decided_at AS decidedAt,s.decision_note AS decisionNote,s.cash_received_at AS cashReceivedAt,
    receiver.display_name AS cashReceivedByName,decider.display_name AS decidedByName,
    'LYD' AS currency,0 AS currencyMismatch,NULL AS linkedCustomerId,NULL AS entryType,s.approved_transaction_id AS approvedTransactionId,CASE WHEN s.status='rejected' AND s.approved_transaction_id IS NOT NULL THEN 1 ELSE 0 END AS approvalCancelled
  FROM collection_submissions s JOIN customers c ON c.id=s.customer_id
    JOIN collection_batches b ON b.id=s.batch_id JOIN users u ON u.id=s.collector_user_id
    LEFT JOIN users receiver ON receiver.id=s.cash_received_by_user_id
    LEFT JOIN users decider ON decider.id=s.decided_by_user_id
  UNION ALL
  SELECT r.id,'unlinked',NULL,r.linked_customer_id,r.organization_id,r.batch_id,b.status,
    r.business_date,r.collector_user_id,u.display_name,r.customer_name,NULL,NULL,r.amount_units,r.status,r.submitted_at,
    r.decided_at,r.decision_note,r.cash_received_at,receiver.display_name,decider.display_name,r.currency,
    EXISTS(SELECT 1 FROM debt_transactions t WHERE t.id=r.approved_transaction_id AND t.currency<>r.currency),r.linked_customer_id,r.entry_type,r.approved_transaction_id,CASE WHEN r.status='rejected' AND r.approved_transaction_id IS NOT NULL THEN 1 ELSE 0 END
  FROM collection_unlinked_receipts r JOIN collection_batches b ON b.id=r.batch_id JOIN users u ON u.id=r.collector_user_id
    LEFT JOIN users receiver ON receiver.id=r.cash_received_by_user_id
    LEFT JOIN users decider ON decider.id=r.decided_by_user_id
) `;

export function collectionWorkspace(db: AppDatabase, actor: AuthenticatedUser, url: URL) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  return readWorkspace(db, actor, url, false);
}

/** A separate employee route always binds the collector to the authenticated identity. */
export function employeeCollectionWorkspace(db: AppDatabase, actor: AuthenticatedUser, url: URL) {
  if (actor.role !== 'employee' || !actor.permissions.has('collections.read'))
    throw forbidden('collections.read');
  return readWorkspace(db, actor, url, true);
}

function readWorkspace(db: AppDatabase, actor: AuthenticatedUser, url: URL, ownOnly: boolean) {
  const batchId = url.searchParams.get('batchId') ?? '';
  const employeeId = ownOnly ? actor.id : (url.searchParams.get('employeeId') ?? '');
  const assignmentId = url.searchParams.get('assignmentId') ?? '';
  const state = url.searchParams.get('state') ?? 'review';
  if (!['review', 'cash', 'all'].includes(state))
    throw badRequest('INVALID_COLLECTION_VIEW', 'عرض الاستلامات غير صالح.');
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw badRequest('INVALID_PAGE', 'رقم الصفحة غير صالح.');
  const limit = 60;
  const exporting = !ownOnly && url.searchParams.get('export') === '1';
  const scope = `organizationId=? AND batchStatus='open'${ownOnly ? '' : ' AND batchId=?'}${employeeId ? ' AND collectorUserId=?' : ''}`;
  const params = [actor.organizationId, ...(!ownOnly ? [batchId] : []), ...(employeeId ? [employeeId] : [])];
  const summary = db
    .prepare(
      receipts +
        `SELECT
    COALESCE(SUM(CASE WHEN status='approved' THEN amountUnits ELSE 0 END),0) AS approvedUnits,
    COALESCE(SUM(CASE WHEN status='approved' AND cashReceivedAt IS NOT NULL THEN amountUnits ELSE 0 END),0) AS receivedUnits,
    COALESCE(SUM(CASE WHEN status='approved' AND cashReceivedAt IS NULL THEN amountUnits ELSE 0 END),0) AS outstandingUnits,
    COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pendingCount,
    COALESCE(SUM(CASE WHEN status='pending' AND kind='unlinked' THEN 1 ELSE 0 END),0) AS unlinkedPendingCount,
    COALESCE(SUM(CASE WHEN status='approved' AND cashReceivedAt IS NULL THEN 1 ELSE 0 END),0) AS cashPendingCount,
    COALESCE(SUM(CASE WHEN status<>'rejected' THEN 1 ELSE 0 END),0) AS receiptCount
    FROM receipts WHERE ${scope}`,
    )
    .get(...params);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const conditions = [scope, "(status<>'rejected' OR approvalCancelled=1)"];
  if (exporting) conditions.push("status='approved'");
  const values: (string | number)[] = [...params];
  if (state === 'review') conditions.push("status='pending'");
  if (state === 'cash') conditions.push("status='approved' AND cashReceivedAt IS NULL");
  if (assignmentId) {
    conditions.push('assignmentId=?');
    values.push(assignmentId);
  }
  if (query) {
    conditions.push('(customerName LIKE ? OR collectorName LIKE ? OR phone LIKE ?)');
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const where = conditions.join(' AND ');
  const total = Number(
    db.prepare(receipts + `SELECT COUNT(*) n FROM receipts WHERE ${where}`).get(...values)!.n,
  );
  const items = db
    .prepare(
      receipts +
        `SELECT * FROM receipts WHERE ${where}
    ORDER BY submittedAt DESC,id DESC,kind${exporting ? '' : ' LIMIT ? OFFSET ?'}`,
    )
    .all(...values, ...(exporting ? [] : [limit, (page - 1) * limit]));
  const employees = db
    .prepare(
      `SELECT id,display_name AS name FROM users WHERE organization_id=?${ownOnly ? ' AND id=?' : ''}
    AND (is_active=1 OR EXISTS(SELECT 1 FROM collection_submissions s WHERE s.collector_user_id=users.id)
      OR EXISTS(SELECT 1 FROM collection_unlinked_receipts r WHERE r.collector_user_id=users.id)) ORDER BY display_name,id`,
    )
    .all(actor.organizationId, ...(ownOnly ? [actor.id] : []));
  return {
    summary,
    employees,
    items,
    totalItems: total,
    page,
    hasMore: !exporting && page * limit < total,
    limit,
  };
}
