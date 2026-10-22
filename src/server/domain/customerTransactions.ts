import { randomUUID } from 'node:crypto';
import { warnDuplicate, todayRange } from './duplicateWarning.ts';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { customerAccount, customerBalance } from './customerAccountRepository.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';
import {
  assertAccountIsEditable,
  assertExpectedVersion,
  audit,
  customerDebtStartedAt,
  emitEvent,
  insertPostedTransaction,
  prepareTransaction,
  readIdempotent,
  rememberIdempotent,
  retireTreasuryEntry,
  safeBalance,
  TREASURY_POSTING_ENABLED,
  transactionPayload,
  updateCustomerAfterLedgerChange,
  validateRequestId,
  type OperationResult,
} from './customerTransactionSupport.ts';

export function addCustomerTransaction(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customerId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
  options: { suppressNotification?: boolean } = {},
): OperationResult {
  const profile = partyProfile(kind);
  const requestId = validateRequestId(input.requestId);
  const scope = `${profile.scope}:${customerId}:transactions:create`;
  return inImmediateTransaction(database, () => {
    const replay = readIdempotent(database, actor.id, scope, requestId, input);
    if (replay) return replay;
    const customer = customerAccount(database, customerId, actor.organizationId, kind);
    assertAccountIsEditable(customer);
    const expectedVersion = assertExpectedVersion(customer, input);
    const currentBalance = customer.currentBalanceUnits;
    const prepared = prepareTransaction(input, currentBalance);
    warnDuplicate(input, () => {
      const { start, end } = todayRange();
      if (prepared.transactionDate < start || prepared.transactionDate >= end) return false;
      return Boolean(database.prepare(`SELECT 1 FROM debt_transactions
        WHERE customer_id=? AND entry_type=? AND amount_units=?
          AND transaction_date>=? AND transaction_date<?
          AND deleted_at IS NULL AND transaction_status='posted' LIMIT 1`)
        .get(customerId, prepared.type, prepared.amountUnits, start, end));
    });
    const transaction = insertPostedTransaction(database, actor, customer, prepared, null, kind);
    const balanceUnits = safeBalance(
      BigInt(currentBalance) +
        BigInt(prepared.type === 'debt' ? prepared.amountUnits : -prepared.amountUnits),
    );
    const debtStartedAt =
      balanceUnits <= 0
        ? null
        : currentBalance <= 0
          ? prepared.transactionDate
          : (customer.debtStartedAt ?? prepared.transactionDate);
    const nextVersion = updateCustomerAfterLedgerChange(
      database,
      customer,
      expectedVersion,
      balanceUnits,
      debtStartedAt,
      transaction.createdAt,
    );
    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.${prepared.type}`,
      'debt_transaction',
      transaction.id,
      correlationId,
      {
        customerId,
        subjectName: customer.name,
        subjectSection: profile.sectionKey,
        amountUnits: prepared.amountUnits,
        paymentMode: prepared.paymentMode,
        sequence: transaction.sequence,
        suppressNotification: options.suppressNotification === true,
      },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.ledger.changed`,
      customerId,
      actor.id,
      actor.organizationId,
      { action: prepared.type, transactionId: transaction.id, version: nextVersion, balanceUnits },
    );
    const result: OperationResult = {
      status: 201,
      body: {
        transaction: transactionPayload(transaction, actor.displayName, kind),
        customerVersion: nextVersion,
        balanceUnits,
      },
      eventSequence,
    };
    rememberIdempotent(database, actor.id, scope, requestId, result, input);
    return result;
  });
}

export function correctCustomerTransaction(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customerId: string,
  transactionId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
): OperationResult {
  const profile = partyProfile(kind);
  const requestId = validateRequestId(input.requestId);
  const scope = `${profile.scope}:${customerId}:transactions:${transactionId}:edit`;
  return inImmediateTransaction(database, () => {
    const replay = readIdempotent(database, actor.id, scope, requestId, input);
    if (replay) return replay;
    const customer = customerAccount(database, customerId, actor.organizationId, kind);
    assertAccountIsEditable(customer);
    const expectedVersion = assertExpectedVersion(customer, input);
    const original = database
      .prepare(
        `SELECT id, customer_sequence, transaction_status, entry_type, amount_units,
           reference_no, created_at
         FROM debt_transactions
         WHERE id = ? AND customer_id = ? AND deleted_at IS NULL`,
      )
      .get(transactionId, customerId) as Record<string, unknown> | undefined;
    if (!original) throw notFound('transaction');
    if (String(original.transaction_status) !== 'posted') {
      throw conflict('TRANSACTION_NOT_EDITABLE', 'لا يمكن تعديل حركة ملغاة.');
    }
    const currentBalance = customerBalance(database, customer.cycleId);
    const originalEffect =
      String(original.entry_type) === 'debt' ? Number(original.amount_units) : -Number(original.amount_units);
    const balanceWithoutOriginal = currentBalance - originalEffect;
    const prepared = prepareTransaction(input, Math.max(0, balanceWithoutOriginal));
    const changedAt = nowIso();
    retireTreasuryEntry(database, transactionId, changedAt, kind);
    database
      .prepare(
        `UPDATE debt_transactions
         SET entry_type = ?, amount_units = ?, calculation_mode = ?,
           input_value_micros = ?, calculation_factor_micros = ?, payment_mode = ?,
           transaction_date = ?, note = ?, actor_user_id = ?, actor_name = ?,
           transaction_status = 'posted', corrects_transaction_id = NULL, updated_at = ?
         WHERE id = ? AND transaction_status = 'posted'`,
      )
      .run(
        prepared.type,
        prepared.amountUnits,
        prepared.calculationMode,
        prepared.inputMicros,
        prepared.factorMicros,
        prepared.paymentMode,
        prepared.transactionDate,
        prepared.note,
        actor.id,
        actor.displayName,
        changedAt,
        transactionId,
      );
    if (TREASURY_POSTING_ENABLED && prepared.type === 'payment' && profile.treasurySource) {
      database
        .prepare(
          `INSERT INTO treasury_transactions(
             id, direction, amount_units, currency, conversion_rate_micros,
             transaction_date, reference_no, source, source_id,
             description, actor_user_id, branch_id, created_at, updated_at
           ) VALUES (?, 'in', ?, 'LYD', 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          prepared.amountUnits,
          prepared.transactionDate,
          String(original.reference_no),
          profile.treasurySource,
          transactionId,
          `${prepared.paymentMode === 'full' ? 'تسديد كلي' : 'دفعة'} من ${kind === 'company' ? 'الشركة' : 'العميل'} ${customer.name}`,
          actor.id,
          actor.homeBranchId,
          changedAt,
          changedAt,
        );
    }
    const balanceUnits = customerBalance(database, customer.cycleId);
    const debtStartedAt = customerDebtStartedAt(database, customer.id, customer.cycleId);
    const nextVersion = updateCustomerAfterLedgerChange(
      database,
      customer,
      expectedVersion,
      balanceUnits,
      debtStartedAt,
      changedAt,
    );
    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.transaction.update`,
      'debt_transaction',
      transactionId,
      correlationId,
      {
        customerId,
        subjectName: customer.name,
        subjectSection: profile.sectionKey,
        sequence: Number(original.customer_sequence),
        previous: { type: String(original.entry_type), amountUnits: Number(original.amount_units) },
        next: { type: prepared.type, amountUnits: prepared.amountUnits },
      },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.ledger.changed`,
      customerId,
      actor.id,
      actor.organizationId,
      { action: 'updated', transactionId, version: nextVersion, balanceUnits },
    );
    const updatedTransaction = {
      id: transactionId,
      sequence: Number(original.customer_sequence),
      referenceNo: String(original.reference_no),
      createdAt: String(original.created_at),
      correctsTransactionId: null,
      ...prepared,
    };
    const result: OperationResult = {
      status: 200,
      body: {
        transaction: transactionPayload(updatedTransaction, actor.displayName, kind),
        customerVersion: nextVersion,
        balanceUnits,
      },
      eventSequence,
    };
    rememberIdempotent(database, actor.id, scope, requestId, result, input);
    return result;
  });
}

export function cancelCustomerTransaction(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customerId: string,
  transactionId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
): OperationResult {
  const profile = partyProfile(kind);
  const requestId = validateRequestId(input.requestId);
  const scope = `${profile.scope}:${customerId}:transactions:${transactionId}:cancel`;
  return inImmediateTransaction(database, () => {
    const replay = readIdempotent(database, actor.id, scope, requestId, input);
    if (replay) return replay;
    const customer = customerAccount(database, customerId, actor.organizationId, kind);
    assertAccountIsEditable(customer);
    const expectedVersion = assertExpectedVersion(customer, input);
    const original = database
      .prepare(
        `SELECT id, customer_sequence, transaction_status FROM debt_transactions
         WHERE id = ? AND customer_id = ? AND deleted_at IS NULL`,
      )
      .get(transactionId, customerId) as Record<string, unknown> | undefined;
    if (!original) throw notFound('transaction');
    if (String(original.transaction_status) !== 'posted') {
      throw conflict('TRANSACTION_NOT_CANCELLABLE', 'الحركة مصححة أو ملغاة بالفعل.');
    }
    const changedAt = nowIso();
    database
      .prepare(
        `UPDATE debt_transactions SET transaction_status = 'reversed', updated_at = ?
         WHERE id = ? AND transaction_status = 'posted'`,
      )
      .run(changedAt, transactionId);
    retireTreasuryEntry(database, transactionId, changedAt, kind);
    const balanceUnits = customerBalance(database, customer.cycleId);
    const debtStartedAt = customerDebtStartedAt(database, customer.id, customer.cycleId);
    const nextVersion = updateCustomerAfterLedgerChange(
      database,
      customer,
      expectedVersion,
      balanceUnits,
      debtStartedAt,
      changedAt,
    );
    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.transaction.cancel`,
      'debt_transaction',
      transactionId,
      correlationId,
      {
        customerId,
        subjectName: customer.name,
        subjectSection: profile.sectionKey,
        sequence: Number(original.customer_sequence),
        reason: String(input.reason ?? '').slice(0, 500),
      },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.ledger.changed`,
      customerId,
      actor.id,
      actor.organizationId,
      { action: 'cancelled', transactionId, version: nextVersion, balanceUnits },
    );
    const result: OperationResult = {
      status: 200,
      body: { transactionId, status: 'reversed', customerVersion: nextVersion, balanceUnits },
      eventSequence,
    };
    rememberIdempotent(database, actor.id, scope, requestId, result, input);
    return result;
  });
}
