import { compareCollectionCards, type CollectionCardState } from '../../shared/collectionCardState.ts';
import { randomUUID } from 'node:crypto';
import { warnDuplicate } from './duplicateWarning.ts';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { addCustomerTransaction, createCustomer } from './customers.ts';
import { asPositiveWholeUnits, normalizePartyName } from './customerMoney.ts';
import { validateRequestId, readIdempotent, rememberIdempotent } from './customerTransactionSupport.ts';
import { isValidCalendarDate } from './dates.ts';

const MAX_ASSIGNMENT_CARDS = 500;

const currentBusinessDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type:string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const validBusinessDate = (value:unknown) => {
  const date=String(value??'');
  if(!isValidCalendarDate(date)) throw badRequest('INVALID_BUSINESS_DATE','تاريخ يوم العمل غير صالح.');
  return date;
};

const openCollectionBatch=(db:AppDatabase, organizationId:string)=>{
  const existing=db.prepare("SELECT id,business_date,organization_batch_number AS batch_number FROM collection_batches WHERE organization_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").get(organizationId) as Record<string,unknown>|undefined;
  if(existing)return existing;
  const businessDate=currentBusinessDate();
  const globalRow=db.prepare('SELECT COALESCE(MAX(batch_number),0)+1 nextNumber FROM collection_batches WHERE business_date=?').get(businessDate) as {nextNumber:number};
  const organizationRow=db.prepare('SELECT COALESCE(MAX(organization_batch_number),0)+1 nextNumber FROM collection_batches WHERE organization_id=? AND business_date=?').get(organizationId,businessDate) as {nextNumber:number};
  const batch={id:randomUUID(),business_date:businessDate,batch_number:Number(organizationRow.nextNumber)};
  db.prepare("INSERT INTO collection_batches(id,business_date,batch_number,organization_batch_number,status,opened_at,organization_id) VALUES(?,?,?,?,'open',?,?)").run(batch.id,batch.business_date,Number(globalRow.nextNumber),batch.batch_number,nowIso(),organizationId);
  return batch;
};

const audit = (db: AppDatabase, actorId: string, organizationId: string, action: string, entityId: string, correlationId: string, details: unknown) => {
  db.prepare(`INSERT INTO audit_log(actor_user_id, organization_id, action, entity_type, entity_id, correlation_id, outcome, details_json, created_at)
    VALUES (?, ?, ?, 'collection_submission', ?, ?, 'success', ?, ?)`).run(actorId, organizationId, action, entityId, correlationId, JSON.stringify(details), nowIso());
};

const emitCollectionEvent = (db: AppDatabase, aggregateId: string, actorId: string, organizationId: string, action: string, payload: unknown = {}) => {
  const result = db.prepare(`INSERT INTO event_log(topic, aggregate_id, actor_user_id, organization_id, payload_json, created_at)
    VALUES ('collection.changed', ?, ?, ?, ?, ?)`).run(aggregateId, actorId, organizationId, JSON.stringify({ action, ...payload as object }), nowIso());
  return Number(result.lastInsertRowid);
};

const emitDebtAssignmentEvent = (db: AppDatabase, customerId: string, actorId: string, organizationId: string, action: 'assigned' | 'unassigned', sectionKey: string) => {
  const topic = sectionKey === 'company_debts' ? 'company.changed' : 'customer.changed';
  const result = db.prepare(`INSERT INTO event_log(topic, aggregate_id, actor_user_id, organization_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(topic, customerId, actorId, organizationId, JSON.stringify({ action }), nowIso());
  return Number(result.lastInsertRowid);
};

export function listCollectionAssignees(db: AppDatabase, organizationId: string) {
  return { items: db.prepare(`SELECT u.id, u.username, u.display_name AS displayName FROM users u
    JOIN user_permissions p ON p.user_id=u.id AND p.permission='collections.write' AND p.allowed=1
    WHERE u.organization_id=? AND u.is_active=1 ORDER BY u.display_name COLLATE NOCASE`).all(organizationId) };
}

export function listCollections(db: AppDatabase, actor: AuthenticatedUser) {
  const scope = actor.role === 'admin' ? '' : 'AND a.assignee_user_id = ?';
  const params = actor.role === 'admin' ? [actor.organizationId] : [actor.organizationId, actor.id];
  const assignments = db.prepare(`SELECT a.id, a.customer_id AS customerId, a.assignee_user_id AS assigneeUserId,
    a.status, a.business_date AS businessDate, a.batch_id AS batchId, a.assigned_at AS assignedAt, c.name AS customerName, c.phone, c.version AS customerVersion,
    u.display_name AS assigneeName,
    c.current_balance_units AS balanceUnits,
    EXISTS(SELECT 1 FROM collection_submissions s WHERE s.assignment_id=a.id AND s.status='pending') AS hasPending,
    EXISTS(SELECT 1 FROM collection_submissions s WHERE s.assignment_id=a.id AND s.status='pending' AND s.mode='full') AS hasPendingFull,
    (SELECT s.mode FROM collection_submissions s WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC, s.rowid DESC LIMIT 1) AS latestMode,
    (SELECT s.status FROM collection_submissions s WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC, s.rowid DESC LIMIT 1) AS latestStatus,
    (SELECT s.cash_received_at FROM collection_submissions s WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC, s.rowid DESC LIMIT 1) AS latestCashReceivedAt,
    (SELECT s.decided_at FROM collection_submissions s WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC, s.rowid DESC LIMIT 1) AS latestDecisionAt,
    MAX(a.assigned_at, COALESCE(MAX(CASE WHEN t.updated_at <> t.created_at OR NOT EXISTS(SELECT 1 FROM collection_submissions linked WHERE linked.approved_transaction_id=t.id) THEN t.updated_at END),a.assigned_at)) AS externalFinancialUpdatedAt,
    (SELECT MAX(s.submitted_at) FROM collection_submissions s WHERE s.assignment_id=a.id) AS latestSubmissionAt,
    (SELECT COUNT(*) FROM collection_submissions s WHERE s.assignment_id=a.id AND s.status='approved' AND s.cash_received_at IS NULL) AS cashOutstandingCount
    FROM debt_assignments a JOIN customers c ON c.id=a.customer_id
    JOIN users u ON u.id=a.assignee_user_id JOIN customer_cycles cy ON cy.customer_id=c.id AND cy.status='active'
    LEFT JOIN debt_transactions t ON t.customer_id=c.id
    WHERE c.organization_id=? AND a.status='active' ${scope} GROUP BY a.id`).all(...params) as (CollectionCardState & Record<string, unknown>)[];
  assignments.sort(compareCollectionCards);
  const submissions = db.prepare(`SELECT s.id, s.assignment_id AS assignmentId, s.customer_id AS customerId,
    s.collector_user_id AS collectorUserId, s.mode, s.amount_units AS amountUnits, s.status,
    s.business_date AS businessDate, s.batch_id AS batchId, s.submitted_at AS submittedAt, s.decided_at AS decidedAt, s.decision_note AS decisionNote,
    s.cash_received_at AS cashReceivedAt, c.name AS customerName, c.phone,
    u.display_name AS collectorName FROM collection_submissions s
    JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.collector_user_id
    WHERE c.organization_id=? AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=s.batch_id AND b.status='open') ${actor.role === 'admin' ? '' : 'AND s.collector_user_id = ?'} ORDER BY s.submitted_at DESC,s.rowid DESC LIMIT 200`).all(...params);
  const baseMetrics = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='approved' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=s.batch_id AND b.status='open') THEN amount_units ELSE 0 END),0) AS collectedUnits,
    SUM(CASE WHEN status='pending' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=s.batch_id AND b.status='open') THEN 1 ELSE 0 END) AS pendingCount,
    SUM(CASE WHEN status='approved' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=s.batch_id AND b.status='open') THEN 1 ELSE 0 END) AS executedCount,
    SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN amount_units ELSE 0 END) AS cashOutstandingUnits
    FROM collection_submissions s JOIN customers c ON c.id=s.customer_id
    WHERE c.organization_id=? ${actor.role === 'admin' ? '' : 'AND s.collector_user_id = ?'}`).get(...params) as Record<string, unknown>;
  const unlinkedScope = actor.role === 'admin' ? '' : 'AND r.collector_user_id=?';
  const unlinkedReceipts = db.prepare(`SELECT r.id,r.customer_name AS customerName,
    r.amount_units AS amountUnits,r.currency,r.status,r.submitted_at AS submittedAt,
    EXISTS(SELECT 1 FROM debt_transactions t WHERE t.id=r.approved_transaction_id AND t.currency<>r.currency) AS currencyMismatch,
    r.business_date AS businessDate,r.batch_id AS batchId,
    r.linked_customer_id AS linkedCustomerId,r.entry_type AS entryType,
    r.decided_at AS decidedAt,r.decision_note AS decisionNote,
    r.cash_received_at AS cashReceivedAt,u.display_name AS collectorName
    FROM collection_unlinked_receipts r JOIN users u ON u.id=r.collector_user_id
    WHERE r.organization_id=? AND r.status <> 'rejected' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=r.batch_id AND b.status='open') ${unlinkedScope}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      r.submitted_at DESC LIMIT 200`).all(...params);
  const unlinkedMetrics = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN status='approved' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=r.batch_id AND b.status='open') THEN amount_units ELSE 0 END),0) AS collectedUnits,
    SUM(CASE WHEN status='approved' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=r.batch_id AND b.status='open') THEN 1 ELSE 0 END) AS executedCount,
    SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN amount_units ELSE 0 END) AS cashOutstandingUnits,
    SUM(CASE WHEN status='pending' AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=r.batch_id AND b.status='open') THEN 1 ELSE 0 END) AS unlinkedPendingCount
    FROM collection_unlinked_receipts r WHERE r.organization_id=? ${unlinkedScope}`).get(...params) as Record<string, unknown>;
  const metrics = {
    collectedUnits: Number(baseMetrics.collectedUnits) + Number(unlinkedMetrics.collectedUnits),
    pendingCount: Number(baseMetrics.pendingCount),
    executedCount: Number(baseMetrics.executedCount) + Number(unlinkedMetrics.executedCount),
    cashOutstandingUnits: Number(baseMetrics.cashOutstandingUnits) + Number(unlinkedMetrics.cashOutstandingUnits),
    unlinkedPendingCount: Number(unlinkedMetrics.unlinkedPendingCount),
  };
  const employeeTotals = actor.role === 'admin'
    ? (() => {
      const rows = db.prepare(`SELECT u.id AS employeeId, u.display_name AS employeeName,
        COALESCE(SUM(CASE WHEN s.status='approved' THEN s.amount_units ELSE 0 END),0) AS collectedUnits,
        COALESCE(SUM(CASE WHEN s.status='approved' THEN 1 ELSE 0 END),0) AS approvedCount,
        COALESCE(SUM(CASE WHEN s.status='pending' THEN 1 ELSE 0 END),0) AS pendingCount
        FROM users u LEFT JOIN collection_submissions s ON s.collector_user_id=u.id AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=s.batch_id AND b.status='open')
        WHERE u.organization_id=? AND u.is_active=1 AND u.role <> 'admin' GROUP BY u.id,u.display_name
        ORDER BY u.display_name COLLATE NOCASE`).all(actor.organizationId) as Array<Record<string, unknown>>;
      const unlinkedRows = db.prepare(`SELECT collector_user_id AS employeeId,
        COALESCE(SUM(CASE WHEN status='approved' THEN amount_units ELSE 0 END),0) AS collectedUnits,
        COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END),0) AS approvedCount,
        COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pendingCount
        FROM collection_unlinked_receipts r WHERE organization_id=? AND EXISTS(SELECT 1 FROM collection_batches b WHERE b.id=r.batch_id AND b.status='open') GROUP BY collector_user_id`).all(actor.organizationId) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((row) => [String(row.employeeId), row]));
      for (const row of unlinkedRows) {
        const target = byId.get(String(row.employeeId));
        if (!target) continue;
        target.collectedUnits = Number(target.collectedUnits) + Number(row.collectedUnits);
        target.approvedCount = Number(target.approvedCount) + Number(row.approvedCount);
        target.pendingCount = Number(target.pendingCount) + Number(row.pendingCount);
      }
      return rows.map((row) => ({ employeeId: String(row.employeeId), employeeName: String(row.employeeName), collectedUnits: Number(row.collectedUnits), approvedCount: Number(row.approvedCount), pendingCount: Number(row.pendingCount) }));
    })()
    : undefined;
  const openBatches=db.prepare(`SELECT b.id,b.business_date AS businessDate,b.organization_batch_number AS batchNumber,b.opened_at AS openedAt,
    (SELECT COUNT(*) FROM collection_submissions s WHERE s.batch_id=b.id AND s.status='pending')+
    (SELECT COUNT(*) FROM collection_unlinked_receipts r WHERE r.batch_id=b.id AND r.status='pending') AS pendingCount,
    (SELECT COUNT(*) FROM collection_submissions s WHERE s.batch_id=b.id AND s.status='approved' AND s.cash_received_at IS NULL)+
    (SELECT COUNT(*) FROM collection_unlinked_receipts r WHERE r.batch_id=b.id AND r.status='approved' AND r.cash_received_at IS NULL) AS cashPendingCount,
    (SELECT COALESCE(SUM(s.amount_units),0) FROM collection_submissions s WHERE s.batch_id=b.id AND s.status='approved' AND s.cash_received_at IS NULL)+
    (SELECT COALESCE(SUM(r.amount_units),0) FROM collection_unlinked_receipts r WHERE r.batch_id=b.id AND r.status='approved' AND r.cash_received_at IS NULL) AS cashPendingUnits
    FROM collection_batches b WHERE b.organization_id=? AND b.status='open' ORDER BY b.opened_at DESC`).all(actor.organizationId);
  // Keep earlier approved cash reachable even after its assignment is cancelled.
  const outstandingCancelledSubmissions = db.prepare(`SELECT s.id, s.amount_units AS amountUnits,
    c.name AS customerName, u.display_name AS collectorName
    FROM collection_submissions s JOIN debt_assignments a ON a.id=s.assignment_id
    JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.collector_user_id
    WHERE c.organization_id=? AND a.status='cancelled' AND s.status='approved'
      AND s.cash_received_at IS NULL ${actor.role === 'admin' ? '' : 'AND s.collector_user_id = ?'}
    ORDER BY s.submitted_at DESC, s.id`).all(...params);
  const outstandingClosedUnlinkedReceipts=db.prepare(`SELECT r.id,r.amount_units AS amountUnits,r.customer_name AS customerName,u.display_name AS collectorName
    FROM collection_unlinked_receipts r JOIN users u ON u.id=r.collector_user_id JOIN collection_batches b ON b.id=r.batch_id
    WHERE r.organization_id=? AND b.status='closed' AND r.status='approved' AND r.cash_received_at IS NULL ${unlinkedScope}
    ORDER BY r.submitted_at DESC,r.id`).all(...params);
  return { assignments, submissions, unlinkedReceipts, outstandingCancelledSubmissions, outstandingClosedUnlinkedReceipts, metrics, employeeTotals, assignedCount: assignments.length, openBatches };
}

export function createUnlinkedCollectionReceipt(
  db: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
) {
  if (actor.role === 'admin') throw forbidden('collections.employee_receipt');
  if(input.currency!==undefined&&input.currency!=='LYD')throw badRequest('UNLINKED_RECEIPT_CURRENCY_INVALID','الاستلام غير المرتبط بالدينار الليبي فقط، ولا يقبل تحويل العملة.');
  const requestId = validateRequestId(input.requestId);
  const { name, normalized } = normalizePartyName(input.customerName);
  const amountUnits = asPositiveWholeUnits(input.amountUnits, 'amountUnits');
  return inImmediateTransaction(db, () => {
    const replay = db.prepare(`SELECT id,status,currency,customer_name,amount_units AS amountUnits
      FROM collection_unlinked_receipts WHERE collector_user_id=? AND request_id=?`).get(
      actor.id,
      requestId,
    ) as Record<string, unknown> | undefined;
    if (replay) {
      // All business fields are already stored, including legacy receipts. Compare
      // them before acknowledging a replay; never accept a changed payment silently.
      if (String(replay.customer_name) !== name || Number(replay.amountUnits) !== amountUnits || replay.currency !== 'LYD')
        throw conflict('REQUEST_ID_REUSED', 'استُخدم معرّف الطلب من قبل لمحتوى مختلف.');
      return { id: String(replay.id), status: String(replay.status), currency:'LYD' as const, amountUnits: Number(replay.amountUnits), replayed: true, eventSequences: [] };
    }
    const batch = openCollectionBatch(db, actor.organizationId);
    warnDuplicate(input, () => Boolean(db.prepare(`SELECT 1 FROM collection_unlinked_receipts
      WHERE organization_id=? AND collector_user_id=? AND batch_id=? AND normalized_name=?
        AND amount_units=? AND status IN ('pending','approved') LIMIT 1`)
      .get(actor.organizationId, actor.id, String(batch.id), normalized, amountUnits)));
    const id = randomUUID();
    const submittedAt = nowIso();
    db.prepare(`INSERT INTO collection_unlinked_receipts(
      id,organization_id,collector_user_id,customer_name,normalized_name,amount_units,
      request_id,status,submitted_at,business_date,batch_id,currency
    ) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,'LYD')`).run(
      id,actor.organizationId,actor.id,name,normalized,amountUnits,requestId,
      submittedAt,String(batch.business_date),String(batch.id),
    );
    audit(db,actor.id,actor.organizationId,'collection.unlinked.submit',id,correlationId,{
      subjectName:name,subjectSection:'collections',amountUnits,currency:'LYD',
    });
    const eventSequence=emitCollectionEvent(db,id,actor.id,actor.organizationId,'unlinked_submitted',{amountUnits});
    return {id,status:'pending',amountUnits,currency:'LYD' as const,eventSequences:[eventSequence]};
  });
}

export function collectionLinkCandidates(db: AppDatabase, actor: AuthenticatedUser, queryValue: unknown) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  if (typeof queryValue !== 'string' || queryValue.trim().length < 2) return {items:[]};
  const { normalized }=normalizePartyName(queryValue);
  const tokens=[...new Set(normalized.split(' ').filter((token)=>token.length>=2))].slice(0,6);
  if(!tokens.length)return {items:[]};
  const ftsQuery=tokens.map((token)=>`"${token.replaceAll('"','""')}"*`).join(' OR ');
  const items=db.prepare(`SELECT c.id,c.name,c.current_balance_units AS balanceUnits,
    c.section_key AS sectionKey,'LYD' AS currency
    FROM customer_name_search JOIN customers c ON c.id=customer_name_search.customer_id
    WHERE customer_name_search MATCH ? AND customer_name_search.organization_id=?
      AND c.section_key IN ('customer_debts','company_debts','libyan_deposits')
      AND c.deleted_at IS NULL
    ORDER BY c.normalized_name=? DESC,bm25(customer_name_search),c.financial_updated_at DESC
    LIMIT 12`).all(ftsQuery,actor.organizationId,normalized);
  return {items};
}

export function decideUnlinkedCollectionReceipt(
  db:AppDatabase,
  actor:AuthenticatedUser,
  receiptId:string,
  input:Record<string,unknown>,
  correlationId:string,
){
  if(actor.role!=='admin')throw forbidden('collections.review');
  const decision=input.decision;
  if(decision!=='approve'&&decision!=='reject')throw badRequest('INVALID_DECISION','قرار المراجعة غير صالح.');
  return inImmediateTransaction(db,()=>{
    const row=db.prepare(`SELECT r.*,u.username,u.display_name,u.role,u.home_branch_id
      FROM collection_unlinked_receipts r JOIN users u ON u.id=r.collector_user_id
      WHERE r.id=? AND r.organization_id=?`).get(receiptId,actor.organizationId) as Record<string,unknown>|undefined;
    if(!row)throw notFound('unlinked_collection_receipt');
    if(String(row.status)!=='pending')throw conflict('SUBMISSION_ALREADY_DECIDED','تمت مراجعة هذا الاستلام من قبل.');
    const decidedAt=nowIso();
    const note=typeof input.note==='string'?input.note.trim().slice(0,500):'';
    if(decision==='reject'){
      db.prepare(`UPDATE collection_unlinked_receipts SET status='rejected',decided_by_user_id=?,
        decided_at=?,decision_note=? WHERE id=? AND status='pending'`).run(actor.id,decidedAt,note,receiptId);
      audit(db,actor.id,actor.organizationId,'collection.unlinked.reject',receiptId,correlationId,{note});
      const eventSequence=emitCollectionEvent(db,receiptId,actor.id,actor.organizationId,'unlinked_rejected');
      return {id:receiptId,status:'rejected',eventSequences:[eventSequence]};
    }
    if(row.currency!=='LYD')throw conflict('UNLINKED_RECEIPT_CURRENCY_INVALID','عملة الاستلام غير صالحة؛ يلزم مراجعتها قبل الاعتماد.');
    if(input.currency!==undefined&&input.currency!=='LYD')throw conflict('COLLECTION_CURRENCY_MISMATCH','عملة الاستلام دينار ليبي؛ لا يمكن ربطه بحساب بعملة مختلفة أو تحويله تلقائيًا.');
    let customerId=typeof input.customerId==='string'?input.customerId.trim():'';
    const newAccountKind=input.newAccountKind;
    const entryType=input.entryType;
    if(entryType!=='debt'&&entryType!=='payment'){
      throw badRequest('UNLINKED_RECEIPT_LINK_REQUIRED','اختر الكارت الأصلي ونوع الحركة قبل الاعتماد.');
    }
    let createdAccountEventSequence:number|undefined;
    if(!customerId){
      if(newAccountKind!=='customer'&&newAccountKind!=='company'){
        throw badRequest('UNLINKED_RECEIPT_LINK_REQUIRED','اختر حسابًا موجودًا أو حدد قسم الحساب الجديد.');
      }
      const created=createCustomer(db,actor,{
        name:String(row.customer_name),openingBalance:0,requestId:`unlinked-account-${receiptId}`,
      },correlationId,newAccountKind);
      const createdBody=created.body as {customer:{id:string}};
      customerId=createdBody.customer.id;
      createdAccountEventSequence=created.eventSequence;
    }
    const customer=db.prepare(`SELECT id,name,section_key,current_balance_units,version
      FROM customers WHERE id=? AND organization_id=? AND deleted_at IS NULL
        AND section_key IN ('customer_debts','company_debts','libyan_deposits','egyptian_deposits')`).get(
      customerId,actor.organizationId,
    ) as Record<string,unknown>|undefined;
    if(!customer)throw notFound('customer');
    if(customer.section_key==='egyptian_deposits')throw conflict('COLLECTION_CURRENCY_MISMATCH','عملة الاستلام دينار ليبي؛ لا يمكن ربطه بالأمانات المصرية أو تحويله تلقائيًا.');
    const kinds={customer_debts:'customer',company_debts:'company',libyan_deposits:'depositLyd',egyptian_deposits:'depositEgp'} as const;
    const sectionKey=String(customer.section_key) as keyof typeof kinds;
    const collector:AuthenticatedUser={
      id:String(row.collector_user_id),username:String(row.username),displayName:String(row.display_name),
      role:String(row.role) as 'admin'|'employee',organizationId:actor.organizationId,
      homeBranchId:String(row.home_branch_id),mustChangePassword:false,permissions:new Set(),
      sessionTokenHash:'',csrfHash:'',
    };
    const amountUnits=Number(row.amount_units);
    const paymentMode=entryType==='payment'&&Number(customer.current_balance_units)===amountUnits?'full':'partial';
    const posted=addCustomerTransaction(db,collector,customerId,{
      requestId:`unlinked-collection-${receiptId}`,expectedVersion:Number(customer.version),type:entryType,
      paymentMode,calculationMode:'direct',inputValue:amountUnits,date:String(row.submitted_at),
      note:`استلام غير مربوط سُجل بواسطة ${row.display_name} وربطته الإدارة`,
    },correlationId,kinds[sectionKey],{suppressNotification:true});
    const body=posted.body as {transaction:{id:string};balanceUnits:number};
    db.prepare(`UPDATE collection_unlinked_receipts SET status='approved',linked_customer_id=?,entry_type=?,
      decided_by_user_id=?,decided_at=?,decision_note=?,approved_transaction_id=?
      WHERE id=? AND status='pending'`).run(customerId,entryType,actor.id,decidedAt,note,body.transaction.id,receiptId);
    audit(db,actor.id,actor.organizationId,'collection.unlinked.approve',receiptId,correlationId,{
      customerId,subjectName:String(customer.name),subjectSection:sectionKey,entryType,amountUnits,currency:'LYD',
      transactionId:body.transaction.id,collectorId:row.collector_user_id,
    });
    const eventSequence=emitCollectionEvent(db,receiptId,actor.id,actor.organizationId,'unlinked_approved',{customerId});
    return {id:receiptId,status:'approved',transactionId:body.transaction.id,balanceUnits:body.balanceUnits,
      eventSequences:[createdAccountEventSequence,posted.eventSequence,eventSequence]
        .filter((value):value is number=>typeof value==='number')};
  });
}

export function markUnlinkedCollectionCashReceived(db:AppDatabase,actor:AuthenticatedUser,receiptId:string,correlationId:string){
  if(actor.role!=='admin')throw forbidden('collections.review');
  return inImmediateTransaction(db,()=>{
    const row=db.prepare(`SELECT status,cash_received_at FROM collection_unlinked_receipts
      WHERE id=? AND organization_id=?`).get(receiptId,actor.organizationId) as Record<string,unknown>|undefined;
    if(!row)throw notFound('unlinked_collection_receipt');
    if(String(row.status)!=='approved')throw conflict('SUBMISSION_NOT_APPROVED','لا يمكن استلام النقدية قبل اعتماد الاستلام.');
    if(row.cash_received_at)return{id:receiptId,cashReceivedAt:String(row.cash_received_at),replayed:true,eventSequences:[]};
    const cashReceivedAt=nowIso();
    db.prepare(`UPDATE collection_unlinked_receipts SET cash_received_by_user_id=?,cash_received_at=?
      WHERE id=?`).run(actor.id,cashReceivedAt,receiptId);
    audit(db,actor.id,actor.organizationId,'collection.unlinked.cash_received',receiptId,correlationId,{});
    const eventSequence=emitCollectionEvent(db,receiptId,actor.id,actor.organizationId,'unlinked_cash_received');
    return{id:receiptId,cashReceivedAt,eventSequences:[eventSequence]};
  });
}

export function assignCustomers(db: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  const assigneeId = typeof input.assigneeUserId === 'string' ? input.assigneeUserId.trim() : '';
  const section = input.section === 'companies' ? 'companies' : 'customers';
  const sectionKey = section === 'companies' ? 'company_debts' : 'customer_debts';
  const rawCustomerIds = Array.isArray(input.customerIds) ? input.customerIds : [];
  if (rawCustomerIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 128)) {
    throw badRequest('INVALID_ASSIGNMENT', 'أحد معرّفات الكروت غير صالح.');
  }
  const customerIds = [...new Set(rawCustomerIds.map((id) => String(id).trim()))];
  if (!assigneeId || customerIds.length === 0) throw badRequest('INVALID_ASSIGNMENT', 'اختر الموظف وكارتًا واحدًا على الأقل.');
  if (assigneeId.length > 128 || customerIds.length > MAX_ASSIGNMENT_CARDS) {
    throw badRequest('ASSIGNMENT_LIMIT_EXCEEDED', `يمكن توجيه ${MAX_ASSIGNMENT_CARDS} كارت بحد أقصى في الطلب الواحد.`);
  }
  return inImmediateTransaction(db, () => {
    const assignee = db.prepare(`SELECT u.id FROM users u JOIN user_permissions p ON p.user_id=u.id
      WHERE u.id=? AND u.organization_id=? AND u.is_active=1
        AND p.permission='collections.write' AND p.allowed=1`).get(assigneeId,actor.organizationId);
    if (!assignee) throw badRequest('INVALID_ASSIGNEE', 'الموظف غير نشط أو ليست لديه صلاحية الاستلام.');
    const createdAt = nowIso(); const batch=openCollectionBatch(db,actor.organizationId); const businessDate=String(batch.business_date); const ids: string[] = [];
    for (const customerId of customerIds) {
      const customer = db.prepare("SELECT id,current_balance_units FROM customers WHERE id=? AND organization_id=? AND section_key=? AND deleted_at IS NULL").get(customerId,actor.organizationId,sectionKey) as Record<string,unknown>|undefined;
      if (!customer) throw notFound(section === 'companies' ? 'company' : 'customer');
      if (Number(customer.current_balance_units) <= 0) throw conflict('ASSIGNMENT_REQUIRES_POSITIVE_DEBT', 'يمكن توجيه الكروت ذات الدين الموجب فقط. كارت الصفر أو الأمانة لا يقبل التوجيه.');
      if (db.prepare("SELECT id FROM debt_assignments WHERE customer_id=? AND status='active'").get(customerId)) throw conflict('CUSTOMER_ALREADY_ASSIGNED', 'أحد الكروت محدد لموظف بالفعل.');
      const id = randomUUID();
      db.prepare(`INSERT INTO debt_assignments(id,customer_id,assignee_user_id,assigned_by_user_id,status,assigned_at,business_date,batch_id)
        VALUES(?,?,?,?,'active',?,?,?)`).run(id, customerId, assigneeId, actor.id, createdAt, businessDate, String(batch.id)); ids.push(id);
    }
    audit(db, actor.id, actor.organizationId, 'collection.assign', ids[0], correlationId, { assigneeId, customerIds, section });
    const eventSequence = emitCollectionEvent(db, assigneeId, actor.id, actor.organizationId, 'assigned', { assignmentIds: ids, customerIds, section });
    const customerEventSequences = customerIds.map((customerId) => emitDebtAssignmentEvent(db, customerId, actor.id, actor.organizationId, 'assigned', sectionKey));
    return { assignmentIds: ids, eventSequences: [eventSequence, ...customerEventSequences] };
  });
}

export function submitCollection(db: AppDatabase, actor: AuthenticatedUser, assignmentId: string, input: Record<string, unknown>, correlationId: string) {
  const requestId = validateRequestId(input.requestId);
  const mode = input.mode;
  if (mode !== 'full' && mode !== 'partial') throw badRequest('INVALID_MODE', 'نوع الاستلام غير صالح.');
  const submittedAmount = mode === 'partial' || input.amountUnits !== undefined
    ? asPositiveWholeUnits(input.amountUnits, 'amountUnits') : undefined;
  const fingerprintInput = { assignmentId, mode, ...(submittedAmount === undefined ? {} : { amountUnits: submittedAmount }) };
  const scope = `collections:submissions:${actor.organizationId}`;
  return inImmediateTransaction(db, () => {
    // Keep the original acknowledgement even after approval/rejection or batch cleanup.
    // Authentication/permissions still apply at the route; the key is actor + tenant scoped.
    const replay = readIdempotent(db, actor.id, scope, requestId, fingerprintInput);
    if (replay) return { ...replay.body as { id: string; status: string; amountUnits: number }, replayed: true, eventSequences: [] as number[] };
    const row = db.prepare(`SELECT a.*, c.current_balance_units AS balance,
        c.name AS customer_name,c.section_key
      FROM debt_assignments a JOIN customers c ON c.id=a.customer_id
      WHERE a.id=? AND c.organization_id=?`).get(assignmentId,actor.organizationId) as Record<string, unknown> | undefined;
    if (!row) throw notFound('assignment');
    if (String(row.status) !== 'active') throw conflict('ASSIGNMENT_CLOSED', 'هذا التكليف غير نشط.');
    if (actor.role !== 'admin' && String(row.assignee_user_id) !== actor.id) throw forbidden('collections.write');
    const currentDebt = Number(row.balance);
    if (mode === 'full' && currentDebt <= 0) throw conflict('NO_POSITIVE_DEBT', 'لا يوجد دين موجب للاستلام الكلي.');
    const amount = asPositiveWholeUnits(mode === 'full' ? currentDebt : input.amountUnits, 'amountUnits');
    if (mode === 'full' && input.amountUnits !== undefined && Number(input.amountUnits) !== currentDebt) throw conflict('FULL_AMOUNT_CHANGED', 'الاستلام الكلي يجب أن يساوي الدين الحالي بالضبط.');
    // Distinct partial receipts may await review together. A full receipt must not
    // overlap another pending receipt, whose amount is not posted to the balance yet.
    if (db.prepare("SELECT 1 FROM collection_submissions WHERE assignment_id=? AND status='pending' AND (?='full' OR mode='full')").get(assignmentId,mode)) {
      throw conflict('PENDING_SUBMISSION_EXISTS', 'يوجد استلام معلّق لهذا الكارت وينتظر مراجعة الإدارة.');
    }
    warnDuplicate(input, () => Boolean(db.prepare(`SELECT 1 FROM collection_submissions
      WHERE customer_id=? AND batch_id=? AND mode=? AND amount_units=? AND status='approved' LIMIT 1`)
      .get(String(row.customer_id), String(row.batch_id), mode, amount)));
    const id = randomUUID(); const submittedAt = nowIso();
    db.prepare(`INSERT INTO collection_submissions(id,assignment_id,customer_id,collector_user_id,mode,amount_units,status,submitted_at,business_date,batch_id)
      VALUES(?,?,?,?,?,?,'pending',?,?,?)`).run(id, assignmentId, String(row.customer_id), String(row.assignee_user_id), mode, amount, submittedAt, String(row.business_date), String(row.batch_id));
    audit(db, actor.id, actor.organizationId, 'collection.submit', id, correlationId, {
      assignmentId,
      customerId: String(row.customer_id),
      subjectName: String(row.customer_name),
      subjectSection: String(row.section_key),
      mode,
      paymentMode: mode,
      amountUnits: amount,
    });
    const eventSequence = emitCollectionEvent(db, assignmentId, actor.id, actor.organizationId, 'submitted', { submissionId: id });
    const body = { id, status: 'pending', amountUnits: amount };
    rememberIdempotent(db, actor.id, scope, requestId, { status: 201, body }, fingerprintInput);
    return { ...body, replayed: false, eventSequences: [eventSequence] };
  });
}

export function decideCollection(db: AppDatabase, actor: AuthenticatedUser, submissionId: string, input: Record<string, unknown>, correlationId: string) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  const decision = input.decision; if (decision !== 'approve' && decision !== 'reject') throw badRequest('INVALID_DECISION', 'قرار المراجعة غير صالح.');
  return inImmediateTransaction(db, () => {
    const row = db.prepare(`SELECT s.*, u.username, u.display_name, u.role,
        u.organization_id, u.home_branch_id, c.version AS customer_version, c.section_key
      FROM collection_submissions s JOIN users u ON u.id=s.collector_user_id
      JOIN customers c ON c.id=s.customer_id
      WHERE s.id=? AND c.organization_id=? AND u.organization_id=?`).get(
        submissionId,actor.organizationId,actor.organizationId,
      ) as Record<string, unknown> | undefined;
    if (!row) throw notFound('submission'); if (String(row.status) !== 'pending') throw conflict('SUBMISSION_ALREADY_DECIDED', 'تمت مراجعة هذا الاستلام من قبل.');
    const decidedAt = nowIso(); const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
    if (decision === 'reject') {
      db.prepare("UPDATE collection_submissions SET status='rejected',decided_by_user_id=?,decided_at=?,decision_note=? WHERE id=?").run(actor.id, decidedAt, note, submissionId);
      const cancelled = db.prepare(`UPDATE debt_assignments SET status='cancelled',cancelled_at=? WHERE id=? AND status='active'
        AND NOT EXISTS(SELECT 1 FROM collection_submissions WHERE assignment_id=debt_assignments.id AND status='pending')`)
        .run(decidedAt, String(row.assignment_id));
      audit(db, actor.id, actor.organizationId, 'collection.reject', submissionId, correlationId, { note, assignmentId: row.assignment_id });
      const collectionEvent = emitCollectionEvent(db, submissionId, actor.id, actor.organizationId, 'rejected');
      const assignmentEvents = cancelled.changes ? [emitDebtAssignmentEvent(db, String(row.customer_id), actor.id, actor.organizationId, 'unassigned', String(row.section_key))] : [];
      return { id: submissionId, status: 'rejected', eventSequences: [collectionEvent, ...assignmentEvents] };
    }
    const transactionKind = String(row.section_key) === 'company_debts' ? 'company' : 'customer';
    const collectorPermission = transactionKind === 'company' ? 'companies.write' : 'debts.write';
    const collector: AuthenticatedUser = { id:String(row.collector_user_id), username:String(row.username), displayName:String(row.display_name), role:String(row.role) as 'admin'|'employee', organizationId:String(row.organization_id), homeBranchId:String(row.home_branch_id), mustChangePassword:false, permissions:new Set([collectorPermission]), sessionTokenHash:'', csrfHash:'' };
    const posted = addCustomerTransaction(db, collector, String(row.customer_id), {
      requestId: `collection-${submissionId}`, expectedVersion:Number(row.customer_version), type:'payment', paymentMode:'partial', calculationMode:'direct', inputValue:Number(row.amount_units), date:String(row.submitted_at), note:`استلام بواسطة ${row.display_name}`,
    }, correlationId, transactionKind, { suppressNotification: true });
    const body = posted.body as { transaction: { id: string }; balanceUnits: number };
    db.prepare("UPDATE collection_submissions SET status='approved',decided_by_user_id=?,decided_at=?,decision_note=?,approved_transaction_id=? WHERE id=?").run(actor.id, decidedAt, note, body.transaction.id, submissionId);
    audit(db, actor.id, actor.organizationId, 'collection.approve', submissionId, correlationId, { transactionId: body.transaction.id, collectorId: row.collector_user_id });
    const collectionEvent = emitCollectionEvent(db, submissionId, actor.id, actor.organizationId, 'approved', { customerId: row.customer_id });
    return { id: submissionId, status: 'approved', transactionId: body.transaction.id, balanceUnits: body.balanceUnits, eventSequences: [posted.eventSequence, collectionEvent].filter((value): value is number => typeof value === 'number') };
  });
}

export function markCollectionCashReceived(db: AppDatabase, actor: AuthenticatedUser, submissionId: string, correlationId: string) {
  if (actor.role !== 'admin') throw forbidden('collections.review');
  return inImmediateTransaction(db, () => {
    const row = db.prepare(`SELECT s.status,s.cash_received_at FROM collection_submissions s
      JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND c.organization_id=?`).get(
        submissionId,actor.organizationId,
      ) as Record<string, unknown> | undefined;
    if (!row) throw notFound('submission'); if (String(row.status) !== 'approved') throw conflict('SUBMISSION_NOT_APPROVED', 'لا يمكن استلام النقدية قبل اعتماد الاستلام.');
    if (row.cash_received_at) return { id: submissionId, cashReceivedAt: String(row.cash_received_at), replayed: true };
    const receivedAt=nowIso(); db.prepare('UPDATE collection_submissions SET cash_received_by_user_id=?,cash_received_at=? WHERE id=?').run(actor.id,receivedAt,submissionId);
    audit(db, actor.id, actor.organizationId, 'collection.cash_received', submissionId, correlationId, {});
    const eventSequence = emitCollectionEvent(db, submissionId, actor.id, actor.organizationId, 'cash_received');
    return { id: submissionId, cashReceivedAt: receivedAt, eventSequences: [eventSequence] };
  });
}

export function closeCollectionDay(db: AppDatabase, actor: AuthenticatedUser, input: Record<string,unknown>, correlationId:string) {
  if(actor.role!=='admin') throw forbidden('collections.review');
  const batchId=String(input.batchId??'');
  if(!batchId) throw badRequest('INVALID_BATCH','دفعة العمل غير صالحة.');
  if(input.confirmed!==true) throw badRequest('CONFIRMATION_REQUIRED','يلزم تأكيد استلام النقدية قبل مسح اليوم.');
  return inImmediateTransaction(db,()=>{
    const batch=db.prepare('SELECT id,business_date,status FROM collection_batches WHERE id=? AND organization_id=?').get(batchId,actor.organizationId) as Record<string,unknown>|undefined;
    if(!batch)throw notFound('collection_batch');
    const businessDate=validBusinessDate(batch.business_date);
    if(String(batch.status)==='closed') return {batchId,businessDate,closed:true,replayed:true};
    const blockers=db.prepare(`SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pendingCount,
    SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN 1 ELSE 0 END) cashPendingCount,
    COALESCE(SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN amount_units ELSE 0 END),0) cashPendingUnits
      FROM collection_submissions WHERE batch_id=?`).get(batchId) as Record<string,unknown>;
    const unlinkedBlockers=db.prepare(`SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pendingCount,
      SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN 1 ELSE 0 END) cashPendingCount,
      COALESCE(SUM(CASE WHEN status='approved' AND cash_received_at IS NULL THEN amount_units ELSE 0 END),0) cashPendingUnits
      FROM collection_unlinked_receipts WHERE batch_id=?`).get(batchId) as Record<string,unknown>;
    const pendingCount=Number(blockers.pendingCount)+Number(unlinkedBlockers.pendingCount);
    const cashPendingCount=Number(blockers.cashPendingCount)+Number(unlinkedBlockers.cashPendingCount);
    const cashPendingUnits=Number(blockers.cashPendingUnits)+Number(unlinkedBlockers.cashPendingUnits);
    const exceptional=input.allowOutstandingCash===true;
    if(pendingCount>0||(!exceptional&&cashPendingCount>0)) throw conflict('COLLECTION_DAY_NOT_SETTLED','لا يمكن مسح اليوم قبل اعتماد جميع العمليات واستلام كل النقدية.',{pendingCount,cashPendingCount,cashPendingUnits});
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(exceptional){
      if(reason.length<5||reason.length>500)throw badRequest('EXCEPTION_REASON_REQUIRED','اكتب سبب الإغلاق الاستثنائي من 5 إلى 500 حرف.');
      if(input.expectedCashPendingCount!==cashPendingCount||input.expectedCashPendingUnits!==cashPendingUnits)
        throw conflict('COLLECTION_CASH_CHANGED','تغيّرت النقدية غير المستلمة. راجع القيم وأعد التأكيد.',{cashPendingCount,cashPendingUnits});
    }
    const submissionCount=Number((db.prepare('SELECT COUNT(*) count FROM collection_submissions WHERE batch_id=?').get(batchId) as {count:number}).count);
    const unlinkedReceiptCount=Number((db.prepare('SELECT COUNT(*) count FROM collection_unlinked_receipts WHERE batch_id=?').get(batchId) as {count:number}).count);
    const assignedCards=db.prepare(`SELECT a.customer_id AS customerId,c.section_key AS sectionKey
      FROM debt_assignments a JOIN customers c ON c.id=a.customer_id
      WHERE a.batch_id=? AND c.organization_id=?`).all(batchId,actor.organizationId) as Array<{customerId:string;sectionKey:string}>;
    const assignmentCount=assignedCards.length;
    const closedAt=nowIso();
    const archived=exceptional&&cashPendingCount>0;
    if(archived){
      // Keep the original approved receipts and their cash liability reachable.
      // Cancelling the assignments removes work cards without marking cash received.
      db.prepare("UPDATE debt_assignments SET status='cancelled',cancelled_at=COALESCE(cancelled_at,?) WHERE batch_id=?").run(closedAt,batchId);
    }else{
      db.prepare('DELETE FROM collection_submissions WHERE batch_id=?').run(batchId);
      db.prepare('DELETE FROM collection_unlinked_receipts WHERE batch_id=?').run(batchId);
      db.prepare('DELETE FROM debt_assignments WHERE batch_id=?').run(batchId);
    }
    const deletedAssignments=archived?0:assignmentCount,deletedSubmissions=archived?0:submissionCount,deletedUnlinkedReceipts=archived?0:unlinkedReceiptCount;
    db.prepare("UPDATE collection_batches SET status='closed',closed_by_user_id=?,closed_at=?,deleted_assignments=?,deleted_submissions=? WHERE id=?").run(actor.id,closedAt,deletedAssignments,deletedSubmissions,batchId);
    audit(db,actor.id,actor.organizationId,'collection.batch.close',batchId,correlationId,{businessDate,deletedAssignments,deletedSubmissions,deletedUnlinkedReceipts,
      ...(archived?{exceptional:true,reason,cashPendingCount,cashPendingUnits,retainedAssignments:assignmentCount,retainedSubmissions:submissionCount,retainedUnlinkedReceipts:unlinkedReceiptCount}:{})});
    const eventSequence=emitCollectionEvent(db,batchId,actor.id,actor.organizationId,'batch_closed',{businessDate});
    const customerEventSequences=assignedCards.map((card)=>emitDebtAssignmentEvent(db,String(card.customerId),actor.id,actor.organizationId,'unassigned',String(card.sectionKey)));
    return {batchId,businessDate,closed:true,deletedAssignments,deletedSubmissions,deletedUnlinkedReceipts,archived,cashPendingCount,cashPendingUnits,closedAt,eventSequences:[eventSequence,...customerEventSequences]};
  });
}
