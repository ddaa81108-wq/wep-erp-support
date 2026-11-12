import { createHash, randomUUID } from 'node:crypto';
import { inImmediateTransaction, nowIso, type AppDatabase } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { cashInput, ensureCashAccount, requestId, safeUnits } from './treasurySupport.ts';
import { EFFECTIVE_CASH_CTE } from './treasuryCashView.ts';

/** Append a cash difference now; original movements and historical balances remain intact. */
export function correctTreasuryCashEntry(
  db: AppDatabase,
  actor: AuthenticatedUser,
  entryId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  if (actor.role !== 'admin') throw forbidden('treasury.correct');
  const key = requestId(input.requestId),
    parsed = cashInput(input);
  const revision = input.expectedEntryRevision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw badRequest('INVALID_CASH_REVISION', 'حدّث المعاملة قبل تعديلها.');
  const reason =
    input.reason === undefined
      ? 'تعديل مباشر من سجل الخزينة'
      : typeof input.reason === 'string'
        ? input.reason.trim()
        : '';
  if (!reason || reason.length > 500)
    throw badRequest('CASH_CORRECTION_REASON_REQUIRED', 'اكتب سبب التصحيح بما لا يتجاوز 500 حرف.');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ action: 'correct', entryId, ...parsed, revision, reason }))
    .digest('hex');
  return inImmediateTransaction(db, () => {
    const replay = db
      .prepare('SELECT * FROM treasury_cash_requests WHERE organization_id=? AND request_id=?')
      .get(actor.organizationId, key);
    if (replay) {
      if (replay.request_fingerprint !== fingerprint)
        throw conflict('REQUEST_ID_REUSED', 'استُخدم معرّف الطلب من قبل لمحتوى مختلف.');
      return { ...JSON.parse(String(replay.response_json)), replayed: true };
    }
    const original = db
      .prepare('SELECT * FROM treasury_cash_entries WHERE id=? AND organization_id=?')
      .get(entryId, actor.organizationId);
    if (!original) throw notFound('treasury_cash_entry');
    if (db.prepare('SELECT 1 FROM treasury_cash_corrections WHERE adjustment_entry_id=?').get(entryId))
      throw badRequest('CASH_ADJUSTMENT_NOT_EDITABLE', 'عدّل المعاملة الأصلية، وليس حركة التصحيح.');
    const previous = db
      .prepare(
        'SELECT * FROM treasury_cash_corrections WHERE organization_id=? AND entry_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(actor.organizationId, entryId);
    if (Number(previous?.revision ?? 0) !== revision)
      throw conflict('CASH_CORRECTION_CHANGED', 'تم تعديل المعاملة من جهاز آخر. حدّث السجل وراجعها.');
    const account = ensureCashAccount(db, actor.organizationId);
    if (Number(account.version) !== parsed.expectedVersion)
      throw conflict('VERSION_CONFLICT', 'تغير رصيد الخزينة. حدّث السجل ثم راجع التصحيح.');
    const old = previous ?? original;
    if (
      old.direction === parsed.direction &&
      Number(old.amount_units) === parsed.amountUnits &&
      old.description === parsed.description
    )
      throw badRequest('CASH_CORRECTION_UNCHANGED', 'لم تتغير بيانات المعاملة.');
    const oldEffect = BigInt(Number(old.amount_units)) * (old.direction === 'in' ? 1n : -1n);
    const newEffect = BigInt(parsed.amountUnits) * (parsed.direction === 'in' ? 1n : -1n);
    const delta = safeUnits(newEffect - oldEffect, 'فرق تصحيح النقدية');
    const before = Number(account.balance_units),
      after = safeUnits(BigInt(before) + BigInt(delta), 'رصيد الفلوس النشطة');
    // Inline editing also changes the displayed running balances after this row.
    // Reject a change that would make any of those balances numerically unsafe.
    if (delta !== 0) {
      let running = 0n;
      for (const row of db
        .prepare(
          `${EFFECTIVE_CASH_CTE} SELECT id,shown_amount,shown_direction FROM current_entries ORDER BY sequence`,
        )
        .all(actor.organizationId)) {
        const amount = row.id === entryId ? parsed.amountUnits : Number(row.shown_amount);
        const direction = row.id === entryId ? parsed.direction : row.shown_direction;
        running += BigInt(amount) * (direction === 'in' ? 1n : -1n);
        safeUnits(running, 'رصيد السجل بعد التعديل');
      }
      if (running !== BigInt(after))
        throw conflict('CASH_LEDGER_MISMATCH', 'تعذر مطابقة رصيد السجل. حدّث الخزينة وراجعها.');
    }
    const now = nowIso(),
      correctionId = randomUUID(),
      adjustmentId = delta === 0 ? null : randomUUID();
    const sequence = Number(account.next_sequence);
    if (adjustmentId)
      db.prepare(
        `INSERT INTO treasury_cash_entries
      (id,organization_id,sequence,direction,amount_units,description,balance_before_units,balance_after_units,actor_user_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        adjustmentId,
        actor.organizationId,
        sequence,
        delta > 0 ? 'in' : 'out',
        Math.abs(delta),
        `تصحيح المعاملة #${original.sequence} — ${reason}`,
        before,
        after,
        actor.id,
        now,
      );
    db.prepare(
      `INSERT INTO treasury_cash_corrections
      (id,organization_id,entry_id,revision,direction,amount_units,description,reason,adjustment_entry_id,actor_user_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      correctionId,
      actor.organizationId,
      entryId,
      Number(revision) + 1,
      parsed.direction,
      parsed.amountUnits,
      parsed.description,
      reason,
      adjustmentId,
      actor.id,
      now,
    );
    const changed = db
      .prepare(
        `UPDATE treasury_cash_accounts SET balance_units=?,next_sequence=?,version=version+1,updated_at=?
      WHERE organization_id=? AND version=?`,
      )
      .run(after, sequence + (adjustmentId ? 1 : 0), now, actor.organizationId, parsed.expectedVersion);
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير رصيد الخزينة أثناء التصحيح.');
    db.prepare(
      `INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,?,'treasury.cash.correct','treasury_cash_entry',?,?,'success',?,?)`,
    ).run(
      actor.id,
      actor.organizationId,
      entryId,
      correlationId,
      JSON.stringify({
        reason,
        revision: Number(revision) + 1,
        originalSequence: Number(original.sequence),
        previous: {
          direction: old.direction,
          amountUnits: Number(old.amount_units),
          description: old.description,
        },
        corrected: {
          direction: parsed.direction,
          amountUnits: parsed.amountUnits,
          description: parsed.description,
        },
        deltaUnits: delta,
        before,
        after,
        adjustmentEntryId: adjustmentId,
      }),
      now,
    );
    const event = db
      .prepare(
        `INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
      VALUES('treasury.changed',?,?,?,?,?)`,
      )
      .run(
        actor.organizationId,
        actor.id,
        actor.organizationId,
        JSON.stringify({ action: 'cash_corrected', entryId, cashVersion: parsed.expectedVersion + 1 }),
        now,
      );
    const result = {
      correctionId,
      entryId,
      revision: Number(revision) + 1,
      adjustmentEntryId: adjustmentId,
      deltaUnits: delta,
      activeCashUnits: after,
      cashVersion: parsed.expectedVersion + 1,
      eventSequence: Number(event.lastInsertRowid),
    };
    db.prepare('INSERT INTO treasury_cash_requests VALUES(?,?,?,?,?)').run(
      actor.organizationId,
      key,
      fingerprint,
      JSON.stringify(result),
      now,
    );
    return { ...result, replayed: false };
  });
}
