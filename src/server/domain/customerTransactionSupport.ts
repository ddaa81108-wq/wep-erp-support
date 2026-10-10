import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import {
  calculateCustomerAmount,
  MAX_PRECISE_WHOLE_UNITS,
  validateTransactionDate,
} from './customerMoney.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';
import type { CustomerAccount } from './customerAccountRepository.ts';

export type OperationResult = {
  status: number;
  body: Record<string, unknown>;
  eventSequence?: number;
  replayed?: boolean;
};

// الخزينة مرحلة مستقبلية؛ إبقاء هذا المفتاح مغلقًا يمنع أي ترحيل خفي الآن.
export const TREASURY_POSTING_ENABLED = false;

export function safeBalance(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw badRequest('BALANCE_OUT_OF_RANGE', 'إجمالي الرصيد تجاوز نطاق الحساب المالي الآمن.');
  }
  return Number(value);
}

export type PreparedTransaction = {
  type: 'debt' | 'payment';
  paymentMode: 'partial' | 'full' | null;
  calculationMode: 'direct' | 'multiply' | 'divide';
  inputMicros: number;
  factorMicros: number | null;
  amountUnits: number;
  transactionDate: string;
  note: string;
};

export function validateRequestId(value: unknown) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw badRequest('REQUEST_ID_REQUIRED', 'يلزم requestId ثابت وآمن لهذه العملية.');
  }
  return value;
}

export function readIdempotent(database: AppDatabase, actorId: string, scope: string, requestId: string) {
  const row = database.prepare(`
    SELECT response_status, response_json FROM idempotency_keys
    WHERE actor_user_id = ? AND scope = ? AND request_id = ?
  `).get(actorId, scope, requestId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    status: Number(row.response_status),
    body: JSON.parse(String(row.response_json)),
    replayed: true,
  } satisfies OperationResult;
}

export function rememberIdempotent(
  database: AppDatabase,
  actorId: string,
  scope: string,
  requestId: string,
  result: OperationResult,
) {
  database.prepare(`
    INSERT INTO idempotency_keys(
      actor_user_id, scope, request_id, response_status, response_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(actorId, scope, requestId, result.status, JSON.stringify(result.body), nowIso());
}

export function nextCustomerReference(database: AppDatabase, kind: DebtPartyKind) {
  const profile = partyProfile(kind);
  const row = database.prepare(`
    UPDATE reference_sequences SET next_value = next_value + 1
    WHERE name = ?
    RETURNING next_value - 1 AS value
  `).get(profile.reference) as { value: number };
  return `${profile.referencePrefix}-${String(Number(row.value)).padStart(8, '0')}`;
}

export function nextCustomerSequence(database: AppDatabase, customerId: string) {
  const row = database.prepare(`
    UPDATE customers SET ledger_next_sequence = ledger_next_sequence + 1
    WHERE id = ? RETURNING ledger_next_sequence - 1 AS value
  `).get(customerId) as { value: number } | undefined;
  if (!row) throw notFound('customer');
  return Number(row.value);
}

export function emitEvent(
  database: AppDatabase,
  topic: string,
  aggregateId: string,
  actorId: string,
  organizationId: string,
  payload: unknown,
) {
  const result = database.prepare(`
    INSERT INTO event_log(topic, aggregate_id, actor_user_id, organization_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(topic, aggregateId, actorId, organizationId, JSON.stringify(payload), nowIso());
  return Number(result.lastInsertRowid);
}

export function audit(
  database: AppDatabase,
  actorId: string,
  organizationId: string,
  action: string,
  entityType: string,
  entityId: string,
  correlationId: string,
  details: unknown,
) {
  database.prepare(`
    INSERT INTO audit_log(
      actor_user_id, organization_id, action, entity_type, entity_id,
      correlation_id, outcome, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?)
  `).run(actorId, organizationId, action, entityType, entityId, correlationId, JSON.stringify(details), nowIso());
}

export function safeOpeningBalance(value: unknown) {
  const numeric = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_PRECISE_WHOLE_UNITS) {
    throw badRequest('INVALID_OPENING_BALANCE', 'المبلغ الافتتاحي يجب أن يكون عددًا صحيحًا موجبًا أو صفرًا.');
  }
  return numeric;
}

export function normalizePhone(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null;
}

export function assertAccountIsEditable(customer: CustomerAccount) {
  if (customer.systemLinkKey) {
    throw conflict(
      'SYSTEM_LINK_ACCOUNT_PROTECTED',
      'هذا كارت مرتبط بالنظام ويتحدث تلقائيًا من القسم المصدر ولا يقبل التعديل اليدوي.',
    );
  }
}

export function customerDebtStartedAt(database: AppDatabase, customerId: string, cycleId: string) {
  const cycle = database.prepare(`
    SELECT initial_balance_units, start_date FROM customer_cycles WHERE id = ?
  `).get(cycleId) as { initial_balance_units: number; start_date: string };
  const rows = database.prepare(`
    SELECT entry_type, amount_units, conversion_rate_micros, transaction_date
    FROM debt_transactions
    WHERE customer_id = ? AND cycle_id = ?
      AND deleted_at IS NULL AND transaction_status = 'posted'
    ORDER BY customer_sequence ASC, created_at ASC
  `).all(customerId, cycleId) as Record<string, unknown>[];
  let balance = Number(cycle.initial_balance_units);
  let startedAt: string | null = balance > 0 ? String(cycle.start_date) : null;
  for (const row of rows) {
    const amount = Math.trunc(
      (Number(row.amount_units) * Number(row.conversion_rate_micros)) / 1_000_000,
    );
    const next = safeBalance(
      BigInt(balance) + BigInt(String(row.entry_type) === 'debt' ? amount : -amount),
    );
    if (balance <= 0 && next > 0) startedAt = String(row.transaction_date);
    if (next <= 0) startedAt = null;
    balance = next;
  }
  return startedAt;
}

export function assertExpectedVersion(customer: CustomerAccount, input: Record<string, unknown>) {
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion)) {
    throw badRequest('EXPECTED_VERSION_REQUIRED', 'يلزم إرسال expectedVersion لمنع استبدال تعديل أحدث.');
  }
  if (expectedVersion !== customer.version) {
    throw conflict('VERSION_CONFLICT', 'عُدّل الحساب على جهاز آخر. حدّث البيانات ثم حاول مجددًا.', {
      expectedVersion,
      currentVersion: customer.version,
    });
  }
  return expectedVersion;
}

export function prepareTransaction(
  input: Record<string, unknown>,
  currentBalanceUnits: number,
): PreparedTransaction {
  const type = input.type;
  if (type !== 'debt' && type !== 'payment') {
    throw badRequest('INVALID_TRANSACTION_TYPE', 'نوع الحركة يجب أن يكون دينًا أو سدادًا.');
  }
  const paymentMode = type === 'payment'
    ? input.paymentMode === 'full' ? 'full' : 'partial'
    : null;
  let calculation = calculateCustomerAmount(input.inputValue, input.calculationMode, input.factor);
  if (paymentMode === 'full') {
    if (currentBalanceUnits <= 0) {
      throw badRequest('FULL_PAYMENT_NOT_ALLOWED', 'لا يوجد رصيد موجب يسمح بالسداد الكلي.');
    }
    calculation = {
      mode: 'direct',
      inputMicros: currentBalanceUnits * 1_000_000,
      factorMicros: null,
      amountUnits: currentBalanceUnits,
    };
  }
  return {
    type,
    paymentMode,
    calculationMode: calculation.mode,
    inputMicros: calculation.inputMicros,
    factorMicros: calculation.factorMicros,
    amountUnits: calculation.amountUnits,
    transactionDate: validateTransactionDate(input.date),
    note: typeof input.note === 'string' ? input.note.trim().slice(0, 1_000) : '',
  };
}

export function insertPostedTransaction(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customer: CustomerAccount,
  prepared: PreparedTransaction,
  correctsTransactionId: string | null = null,
  kind: DebtPartyKind = 'customer',
) {
  const profile = partyProfile(kind);
  const id = randomUUID();
  const sequence = nextCustomerSequence(database, customer.id);
  const referenceNo = nextCustomerReference(database, kind);
  const createdAt = nowIso();
  database.prepare(`
    INSERT INTO debt_transactions(
      id, customer_id, cycle_id, entry_type, amount_units, currency,
      conversion_rate_micros, calculation_mode, input_value_micros,
      calculation_factor_micros, payment_mode, transaction_date,
      reference_no, note, actor_user_id, actor_name, branch_id,
      customer_sequence, transaction_status, corrects_transaction_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)
  `).run(
    id, customer.id, customer.cycleId, prepared.type, prepared.amountUnits,
    profile.currency,
    prepared.calculationMode, prepared.inputMicros, prepared.factorMicros,
    prepared.paymentMode, prepared.transactionDate, referenceNo, prepared.note,
    actor.id, actor.displayName, actor.homeBranchId, sequence, correctsTransactionId,
    createdAt, createdAt,
  );
  if (TREASURY_POSTING_ENABLED && prepared.type === 'payment' && profile.treasurySource) {
    database.prepare(`
      INSERT INTO treasury_transactions(
        id, direction, amount_units, currency, conversion_rate_micros,
        transaction_date, reference_no, source, source_id,
        description, actor_user_id, branch_id, created_at, updated_at
      ) VALUES (?, 'in', ?, 'LYD', 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), prepared.amountUnits, prepared.transactionDate, referenceNo, profile.treasurySource, id,
      `${prepared.paymentMode === 'full' ? 'تسديد كلي' : 'دفعة'} من ${kind === 'company' ? 'الشركة' : 'العميل'} ${customer.name}`,
      actor.id, actor.homeBranchId, createdAt, createdAt,
    );
  }
  return { id, sequence, referenceNo, createdAt, correctsTransactionId, ...prepared };
}

export function transactionPayload(transaction: PreparedTransaction & {
  id: string;
  sequence: number;
  referenceNo: string;
  createdAt: string;
  correctsTransactionId: string | null;
}, actorName: string, kind: DebtPartyKind = 'customer') {
  return {
    id: transaction.id,
    type: transaction.type,
    amountUnits: transaction.amountUnits,
    currency: partyProfile(kind).currency,
    paymentMode: transaction.paymentMode,
    calculationMode: transaction.calculationMode,
    inputValue: transaction.inputMicros / 1_000_000,
    factorMicros: transaction.factorMicros,
    transactionDate: transaction.transactionDate,
    referenceNo: transaction.referenceNo,
    note: transaction.note,
    actorName,
    sequence: transaction.sequence,
    status: 'posted',
    correctsTransactionId: transaction.correctsTransactionId,
    createdAt: transaction.createdAt,
  };
}

export function updateCustomerAfterLedgerChange(
  database: AppDatabase,
  customer: CustomerAccount,
  expectedVersion: number,
  balanceUnits: number,
  debtStartedAt: string | null,
  changedAt: string,
) {
  if (!Number.isSafeInteger(balanceUnits)) {
    throw badRequest('BALANCE_OUT_OF_RANGE', 'الرصيد الناتج تجاوز نطاق الحساب المالي الآمن.');
  }
  const nextVersion = expectedVersion + 1;
  const updated = database.prepare(`
    UPDATE customers
    SET version = ?, updated_at = ?, current_balance_units = ?,
      debt_started_at = ?, financial_updated_at = ?,
      inactive_since = CASE
        WHEN ? = 0 THEN COALESCE(inactive_since, ?)
        ELSE NULL
      END
    WHERE id = ? AND version = ?
  `).run(
    nextVersion, changedAt, balanceUnits, debtStartedAt, changedAt,
    balanceUnits, changedAt, customer.id, expectedVersion,
  );
  if (Number(updated.changes) !== 1) throw conflict('VERSION_CONFLICT', 'عُدل الحساب أثناء تنفيذ الطلب.');
  return nextVersion;
}

export function retireTreasuryEntry(database: AppDatabase, transactionId: string, changedAt: string, kind: DebtPartyKind) {
  const profile = partyProfile(kind);
  if (!TREASURY_POSTING_ENABLED || !profile.treasurySource) return;
  database.prepare(`
    UPDATE treasury_transactions SET deleted_at = ?, updated_at = ?
    WHERE source = ? AND source_id = ? AND deleted_at IS NULL
  `).run(changedAt, changedAt, profile.treasurySource, transactionId);
}
