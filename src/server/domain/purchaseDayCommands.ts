import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { syncEgyptianLinkedAccounts } from './linkedAccounts.ts';
import {
  audit,
  ensureMerchant,
  ensureOpenDay,
  event,
  integer,
  merchantKey,
  remember,
  replay,
  requestFingerprint,
  requestId,
} from './purchaseSupport.ts';

export function setPurchaseOpening(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  return inImmediateTransaction(db, () => {
    const merchant = ensureMerchant(db, actor.organizationId, key, actor.id);
    const day = ensureOpenDay(db, actor.organizationId, merchant, actor.id);
    const count = db
      .prepare('SELECT COUNT(*) count FROM purchase_entries WHERE merchant_id=? AND deleted_at IS NULL')
      .get(String(merchant.id)) as { count: number };
    if (Number(day.day_number) !== 1 || Number(count.count) !== 0) {
      throw conflict('OPENING_BALANCE_LOCKED', 'يمكن ضبط القيم السابقة قبل أول معاملة فقط.');
    }
    const version = integer(input.expectedDayVersion, 'إصدار اليوم');
    if (Number(day.version) !== version) throw conflict('VERSION_CONFLICT', 'تغيرت القيم من جلسة أخرى.');
    const debt = integer(input.previousDebtUnits, 'القيمة السابقة', true);
    const vodafone = integer(input.previousVodafoneUnits, 'فودافون المرحّل', true);
    db.prepare(
      `UPDATE purchase_days
       SET previous_debt_units=?,previous_vodafone_units=?,total_debt_units=?,
         vodafone_remaining_units=?,version=version+1,updated_at=?
       WHERE id=? AND version=?`,
    ).run(debt, vodafone, debt, vodafone, nowIso(), String(day.id), version);
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    audit(db, actor, 'purchases.opening.update', String(day.id), correlationId, { merchant: key });
    return {
      eventSequences: [event(db, actor, String(merchant.id), 'opening-updated'), ...linked.eventSequences],
    };
  });
}

export function finalizePurchaseDay(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  const idempotency = requestId(input.requestId);
  const fingerprint = requestFingerprint('finalize', key, 'current-day', {
    expectedDayVersion: input.expectedDayVersion,
  });
  return inImmediateTransaction(db, () => {
    const repeated = replay(db, actor.organizationId, idempotency, 'finalize', fingerprint);
    if (repeated) return repeated;
    const merchant = ensureMerchant(db, actor.organizationId, key, actor.id);
    const day = ensureOpenDay(db, actor.organizationId, merchant, actor.id);
    const version = integer(input.expectedDayVersion, 'إصدار اليوم');
    if (Number(day.version) !== version) throw conflict('VERSION_CONFLICT', 'تغير اليوم قبل الترحيل.');
    const count = db
      .prepare('SELECT COUNT(*) count FROM purchase_entries WHERE day_id=? AND deleted_at IS NULL')
      .get(String(day.id)) as { count: number };
    if (Number(count.count) === 0) throw badRequest('EMPTY_PURCHASE_DAY', 'لا يمكن ترحيل يوم بدون معاملات.');
    const at = nowIso();
    const changed = db
      .prepare(
        `UPDATE purchase_days
         SET status='finalized',finalized_by_user_id=?,finalized_at=?,version=version+1,updated_at=?
         WHERE id=? AND status='draft' AND version=?`,
      )
      .run(actor.id, at, at, String(day.id), version);
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير اليوم أثناء الترحيل.');
    audit(db, actor, 'purchases.day.finalize', String(day.id), correlationId, {
      merchant: key,
      dayNumber: Number(day.day_number),
    });
    const response = { finalizedDayId: String(day.id) };
    remember(db, actor.organizationId, idempotency, 'finalize', fingerprint, response);
    ensureOpenDay(db, actor.organizationId, merchant, actor.id);
    return { ...response, eventSequences: [event(db, actor, String(merchant.id), 'finalized')] };
  });
}

export function setPurchaseDayCorrection(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  dayId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const key = merchantKey(keyValue);
  const open = input.open === true;
  const expectedVersion = integer(input.expectedVersion, 'إصدار اليوم');
  return inImmediateTransaction(db, () => {
    const day = db
      .prepare(
        `SELECT d.*,m.merchant_key FROM purchase_days d
         JOIN purchase_merchants m ON m.id=d.merchant_id
         WHERE d.id=? AND d.organization_id=?`,
      )
      .get(dayId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!day || String(day.merchant_key) !== key) throw notFound('purchase_day');
    if (String(day.status) !== 'finalized') {
      throw conflict('PURCHASE_DAY_NOT_FINALIZED', 'اليوم الحالي مفتوح بالفعل.');
    }
    if (Number(day.version) !== expectedVersion) {
      throw conflict('VERSION_CONFLICT', 'تغير اليوم من جلسة أخرى.');
    }
    if (open) {
      const other = db
        .prepare(
          `SELECT id FROM purchase_days
           WHERE organization_id=? AND merchant_id=? AND correction_open=1 AND id<>?`,
        )
        .get(actor.organizationId, String(day.merchant_id), dayId);
      if (other) throw conflict('ANOTHER_PURCHASE_DAY_OPEN', 'أنهِ تعديل اليوم المفتوح أولًا.');
    }
    const at = nowIso();
    const changed = db
      .prepare(
        `UPDATE purchase_days
         SET correction_open=?,correction_opened_by_user_id=?,correction_opened_at=?,
           version=version+1,updated_at=?
         WHERE id=? AND version=?`,
      )
      .run(open ? 1 : 0, open ? actor.id : null, open ? at : null, at, dayId, expectedVersion);
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير اليوم أثناء تنفيذ الطلب.');
    audit(
      db,
      actor,
      open ? 'purchases.day.correction.open' : 'purchases.day.correction.close',
      dayId,
      correlationId,
      { merchant: key },
    );
    return {
      dayId,
      correctionOpen: open,
      eventSequences: [
        event(db, actor, String(day.merchant_id), open ? 'correction-opened' : 'correction-closed'),
      ],
    };
  });
}
