import { randomUUID } from 'node:crypto';
import { warnDuplicate } from './duplicateWarning.ts';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { syncEgyptianLinkedAccounts } from './linkedAccounts.ts';
import {
  audit,
  ensureMerchant,
  ensureOpenDay,
  event,
  integer,
  merchantKey,
  parseEntry,
  recalculate,
  remember,
  replay,
  requestFingerprint,
  requestId,
} from './purchaseSupport.ts';

export function createPurchaseEntry(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  const idempotency = requestId(input.requestId);
  const parsed = parseEntry(input);
  const fingerprint = requestFingerprint('create', key, 'new', parsed);
  return inImmediateTransaction(db, () => {
    const repeated = replay(db, actor.organizationId, idempotency, 'create', fingerprint);
    if (repeated) return repeated;
    const merchant = ensureMerchant(db, actor.organizationId, key, actor.id);
    const day = ensureOpenDay(db, actor.organizationId, merchant, actor.id);
    const expectedDayVersion = integer(input.expectedDayVersion, 'إصدار اليوم');
    if (Number(day.version) !== expectedDayVersion)
      throw conflict('VERSION_CONFLICT', 'تغير سجل المشتريات من جلسة أخرى.');
    warnDuplicate(input, () => Boolean(db.prepare(`SELECT 1 FROM purchase_entries
      WHERE organization_id=? AND merchant_id=? AND day_id=? AND item_code=? AND item_label=?
        AND egp_value_units=? AND result_units=? AND paid_units=? AND vodafone_consumed_units=?
        AND deleted_at IS NULL LIMIT 1`).get(actor.organizationId, String(merchant.id), String(day.id),
      parsed.code, parsed.label, parsed.egpValueUnits, parsed.result, parsed.paidUnits, parsed.vodafoneConsumedUnits)));
    const entryId = randomUUID();
    const at = nowIso();
    const sequence = Number(merchant.next_sequence);
    db.prepare(
      `INSERT INTO purchase_entries(id,organization_id,merchant_id,day_id,sequence,item_code,item_label,egp_value_units,
       calculation_mode,exchange_rate_micros,result_units,paid_units,remaining_units,vodafone_consumed_units,actor_user_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      entryId,
      actor.organizationId,
      String(merchant.id),
      String(day.id),
      sequence,
      parsed.code,
      parsed.label,
      parsed.egpValueUnits,
      parsed.operation,
      parsed.rateMicros,
      parsed.result,
      parsed.paidUnits,
      parsed.remaining,
      parsed.vodafoneConsumedUnits,
      actor.id,
      at,
      at,
    );
    db.prepare('UPDATE purchase_merchants SET next_sequence=next_sequence+1 WHERE id=?').run(
      String(merchant.id),
    );
    recalculate(db, String(day.id), expectedDayVersion);
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    audit(db, actor, 'purchases.entry.create', entryId, correlationId, {
      merchant: key,
      sequence,
      subjectName: parsed.label,
      subjectSection: 'purchases',
      amountUnits: parsed.result,
      paidUnits: parsed.paidUnits,
      remainingUnits: parsed.remaining,
      vodafoneConsumedUnits: parsed.vodafoneConsumedUnits,
    });
    const response = { entryId, sequence };
    remember(db, actor.organizationId, idempotency, 'create', fingerprint, response);
    return {
      ...response,
      eventSequences: [event(db, actor, String(merchant.id), 'created'), ...linked.eventSequences],
    };
  });
}

export function updatePurchaseEntry(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  entryId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  const idempotency = requestId(input.requestId);
  const parsed = parseEntry(input);
  const fingerprint = requestFingerprint('update', key, entryId, {
    ...parsed,
    expectedVersion: input.expectedVersion,
    expectedDayVersion: input.expectedDayVersion,
  });
  return inImmediateTransaction(db, () => {
    const repeated = replay(db, actor.organizationId, idempotency, 'update', fingerprint);
    if (repeated) return repeated;
    const row = db
      .prepare(
        `SELECT e.*,d.version day_version,d.status day_status,d.correction_open,m.merchant_key FROM purchase_entries e
         JOIN purchase_days d ON d.id=e.day_id JOIN purchase_merchants m ON m.id=e.merchant_id
         WHERE e.id=? AND e.organization_id=? AND e.deleted_at IS NULL`,
      )
      .get(entryId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row || String(row.merchant_key) !== key) throw notFound('purchase_entry');
    if (String(row.day_status) !== 'draft' && Number(row.correction_open) !== 1)
      throw conflict('PURCHASE_DAY_FINALIZED', 'افتح تعديل اليوم المرحّل أولًا.');
    const expectedVersion = integer(input.expectedVersion, 'إصدار المعاملة');
    const expectedDayVersion = integer(input.expectedDayVersion, 'إصدار اليوم');
    if (Number(row.version) !== expectedVersion || Number(row.day_version) !== expectedDayVersion)
      throw conflict('VERSION_CONFLICT', 'تغيرت المعاملة من جلسة أخرى.');
    const changed = db
      .prepare(
        `UPDATE purchase_entries SET item_code=?,item_label=?,egp_value_units=?,calculation_mode=?,exchange_rate_micros=?,
         result_units=?,paid_units=?,remaining_units=?,vodafone_consumed_units=?,actor_user_id=?,version=version+1,updated_at=?
         WHERE id=? AND version=?`,
      )
      .run(
        parsed.code,
        parsed.label,
        parsed.egpValueUnits,
        parsed.operation,
        parsed.rateMicros,
        parsed.result,
        parsed.paidUnits,
        parsed.remaining,
        parsed.vodafoneConsumedUnits,
        actor.id,
        nowIso(),
        entryId,
        expectedVersion,
      );
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغيرت المعاملة أثناء الحفظ.');
    recalculate(db, String(row.day_id), expectedDayVersion);
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    audit(db, actor, 'purchases.entry.update', entryId, correlationId, {
      merchant: key,
      subjectName: parsed.label,
      subjectSection: 'purchases',
      amountUnits: parsed.result,
      paidUnits: parsed.paidUnits,
      remainingUnits: parsed.remaining,
      vodafoneConsumedUnits: parsed.vodafoneConsumedUnits,
    });
    const response = { entryId };
    remember(db, actor.organizationId, idempotency, 'update', fingerprint, response);
    return {
      ...response,
      eventSequences: [event(db, actor, String(row.merchant_id), 'updated'), ...linked.eventSequences],
    };
  });
}

export function deletePurchaseEntry(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  entryId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  const idempotency = requestId(input.requestId);
  const fingerprint = requestFingerprint('delete', key, entryId, {
    expectedVersion: input.expectedVersion,
    expectedDayVersion: input.expectedDayVersion,
  });
  return inImmediateTransaction(db, () => {
    const repeated = replay(db, actor.organizationId, idempotency, 'delete', fingerprint);
    if (repeated) return repeated;
    const row = db
      .prepare(
        `SELECT e.*,d.version day_version,d.status day_status,d.correction_open,m.merchant_key
         FROM purchase_entries e JOIN purchase_days d ON d.id=e.day_id
         JOIN purchase_merchants m ON m.id=e.merchant_id
         WHERE e.id=? AND e.organization_id=? AND e.deleted_at IS NULL`,
      )
      .get(entryId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!row || String(row.merchant_key) !== key) throw notFound('purchase_entry');
    if (String(row.day_status) !== 'draft' && Number(row.correction_open) !== 1)
      throw conflict('PURCHASE_DAY_FINALIZED', 'افتح تعديل اليوم المرحّل أولًا.');
    const expectedVersion = integer(input.expectedVersion, 'إصدار المعاملة');
    const expectedDayVersion = integer(input.expectedDayVersion, 'إصدار اليوم');
    if (Number(row.version) !== expectedVersion || Number(row.day_version) !== expectedDayVersion)
      throw conflict('VERSION_CONFLICT', 'تغيرت المعاملة من جلسة أخرى.');
    db.prepare(
      'UPDATE purchase_entries SET deleted_at=?,deleted_by_user_id=?,version=version+1 WHERE id=? AND version=?',
    ).run(nowIso(), actor.id, entryId, expectedVersion);
    recalculate(db, String(row.day_id), expectedDayVersion);
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    audit(db, actor, 'purchases.entry.delete', entryId, correlationId, {
      merchant: key,
      subjectName: String(row.item_label),
      subjectSection: 'purchases',
      amountUnits: Number(row.result_units),
    });
    const response = { entryId };
    remember(db, actor.organizationId, idempotency, 'delete', fingerprint, response);
    return {
      ...response,
      eventSequences: [event(db, actor, String(row.merchant_id), 'deleted'), ...linked.eventSequences],
    };
  });
}
