import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { customerAccount } from './customerAccountRepository.ts';
import { normalizePartyName } from './customerMoney.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';
import {
  assertAccountIsEditable,
  assertExpectedVersion,
  audit,
  emitEvent,
  nextCustomerReference,
  normalizePhone,
  readIdempotent,
  rememberIdempotent,
  safeOpeningBalance,
  validateRequestId,
  type OperationResult,
} from './customerTransactionSupport.ts';

export function createCustomer(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
): OperationResult {
  const profile = partyProfile(kind);
  const requestId = validateRequestId(input.requestId);
  const scope = `${profile.scope}:create`;
  return inImmediateTransaction(database, () => {
    const replay = readIdempotent(database, actor.id, scope, requestId);
    if (replay) return replay;
    const { name, normalized } = normalizePartyName(input.name);
    const phone = normalizePhone(input.phone);
    const duplicate = database
      .prepare(
        `SELECT id, name, phone FROM customers
         WHERE organization_id = ? AND section_key = ? AND deleted_at IS NULL
           AND (normalized_name = ? OR (? IS NOT NULL AND phone = ?))
         ORDER BY normalized_name = ? DESC LIMIT 1`,
      )
      .get(actor.organizationId, profile.sectionKey, normalized, phone, phone, normalized) as
      Record<string, unknown> | undefined;
    if (duplicate) {
      throw conflict(profile.duplicateCode, profile.duplicateMessage, {
        customerId: String(duplicate.id),
        customerName: String(duplicate.name),
        customerPhone: duplicate.phone ? String(duplicate.phone) : null,
      });
    }

    const id = randomUUID();
    const cycleId = randomUUID();
    const createdAt = nowIso();
    const openingBalanceUnits = safeOpeningBalance(input.openingBalance);
    database
      .prepare(
        `INSERT INTO customers(
           id, name, normalized_name, phone, account_type, section_key, organization_id, inactive_since,
           ledger_next_sequence, current_balance_units, debt_started_at, financial_updated_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        normalized,
        phone,
        profile.accountType,
        profile.sectionKey,
        actor.organizationId,
        openingBalanceUnits === 0 ? createdAt : null,
        openingBalanceUnits,
        openingBalanceUnits > 0 ? createdAt : null,
        createdAt,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `INSERT INTO customer_cycles(
           id, customer_id, status, start_date, initial_balance_units,
           currency, created_at, updated_at
         ) VALUES (?, ?, 'active', ?, 0, ?, ?, ?)`,
      )
      .run(cycleId, id, createdAt, profile.currency, createdAt, createdAt);

    if (openingBalanceUnits > 0) {
      const referenceNo = nextCustomerReference(database, kind);
      database
        .prepare(
          `INSERT INTO debt_transactions(
             id, customer_id, cycle_id, entry_type, amount_units, currency,
             conversion_rate_micros, calculation_mode, input_value_micros,
             calculation_factor_micros, payment_mode, transaction_date, reference_no,
             note, actor_user_id, actor_name, branch_id, customer_sequence,
             transaction_status, created_at, updated_at
           ) VALUES (?, ?, ?, 'debt', ?, ?, 1000000, 'direct', ?, NULL, NULL,
             ?, ?, 'رصيد افتتاحي', ?, ?, ?, 1, 'posted', ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          cycleId,
          openingBalanceUnits,
          profile.currency,
          openingBalanceUnits * 1_000_000,
          createdAt,
          referenceNo,
          actor.id,
          actor.displayName,
          actor.homeBranchId,
          createdAt,
          createdAt,
        );
      database.prepare('UPDATE customers SET ledger_next_sequence = 2 WHERE id = ?').run(id);
    }

    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.create`,
      profile.entity,
      id,
      correlationId,
      {
        openingBalanceUnits,
        amountUnits: openingBalanceUnits,
        subjectName: name,
        subjectSection: profile.sectionKey,
      },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.changed`,
      id,
      actor.id,
      actor.organizationId,
      { action: 'created', version: 1 },
    );
    const result: OperationResult = {
      status: 201,
      body: {
        customer: {
          id,
          name,
          phone,
          version: 1,
          activeCycleId: cycleId,
          openingBalanceUnits,
          balanceUnits: openingBalanceUnits,
          currency: profile.currency,
          isPinned: false,
          inactiveSince: openingBalanceUnits === 0 ? createdAt : null,
          hiddenFromDefault: false,
          nextSequence: openingBalanceUnits > 0 ? 2 : 1,
          createdAt,
        },
      },
      eventSequence,
    };
    rememberIdempotent(database, actor.id, scope, requestId, result);
    return result;
  });
}

export function updateCustomerDetails(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customerId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
): OperationResult {
  const profile = partyProfile(kind);
  return inImmediateTransaction(database, () => {
    const customer = customerAccount(database, customerId, actor.organizationId, kind);
    assertAccountIsEditable(customer);
    const expectedVersion = assertExpectedVersion(customer, input);
    const { name, normalized } = normalizePartyName(input.name);
    const phone = normalizePhone(input.phone);
    const duplicate = database
      .prepare(
        `SELECT id FROM customers
         WHERE id <> ? AND organization_id = ? AND section_key = ? AND deleted_at IS NULL
           AND (normalized_name = ? OR (? IS NOT NULL AND phone = ?))
         LIMIT 1`,
      )
      .get(customerId, actor.organizationId, profile.sectionKey, normalized, phone, phone) as
      { id: string } | undefined;
    if (duplicate) throw conflict('CUSTOMER_ALREADY_EXISTS', 'يوجد عميل آخر مسجل بالاسم أو رقم الهاتف نفسه.');

    const changedAt = nowIso();
    const nextVersion = expectedVersion + 1;
    const updated = database
      .prepare(
        `UPDATE customers
         SET name = ?, normalized_name = ?, phone = ?, version = ?, updated_at = ?
         WHERE id = ? AND organization_id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .run(
        name,
        normalized,
        phone,
        nextVersion,
        changedAt,
        customerId,
        actor.organizationId,
        expectedVersion,
      );
    if (Number(updated.changes) !== 1) throw conflict('VERSION_CONFLICT', 'عُدلت بيانات العميل أثناء الحفظ.');

    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.update`,
      profile.entity,
      customerId,
      correlationId,
      {
        subjectName: name,
        subjectSection: profile.sectionKey,
        previous: { name: customer.name, phone: customer.phone },
        next: { name, phone },
      },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.changed`,
      customerId,
      actor.id,
      actor.organizationId,
      { action: 'updated', version: nextVersion },
    );
    return { status: 200, body: { customerId, name, phone, customerVersion: nextVersion }, eventSequence };
  });
}

export function setCustomerPinned(
  database: AppDatabase,
  actor: AuthenticatedUser,
  customerId: string,
  input: Record<string, unknown>,
  correlationId: string,
  kind: DebtPartyKind = 'customer',
): OperationResult {
  const profile = partyProfile(kind);
  return inImmediateTransaction(database, () => {
    const customer = customerAccount(database, customerId, actor.organizationId, kind);
    assertAccountIsEditable(customer);
    const expectedVersion = assertExpectedVersion(customer, input);
    if (typeof input.isPinned !== 'boolean') throw badRequest('INVALID_PIN_STATE', 'حالة التثبيت غير صالحة.');
    const changedAt = nowIso();
    const nextVersion = expectedVersion + 1;
    database
      .prepare(
        `UPDATE customers SET is_pinned = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(input.isPinned ? 1 : 0, nextVersion, changedAt, customerId, expectedVersion);
    audit(
      database,
      actor.id,
      actor.organizationId,
      `${profile.entity}.pin`,
      profile.entity,
      customerId,
      correlationId,
      { isPinned: input.isPinned },
    );
    const eventSequence = emitEvent(
      database,
      `${profile.event}.changed`,
      customerId,
      actor.id,
      actor.organizationId,
      { action: input.isPinned ? 'pinned' : 'unpinned', version: nextVersion },
    );
    return {
      status: 200,
      body: { customerId, isPinned: input.isPinned, customerVersion: nextVersion },
      eventSequence,
    };
  });
}
