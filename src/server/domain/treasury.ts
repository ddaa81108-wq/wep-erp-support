import { createHash, randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { conflict } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { cashInput, ensureCashAccount, requestId, safeUnits } from './treasurySupport.ts';

export { treasuryCashLedger, treasuryDashboard } from './treasuryQueries.ts';

export function addTreasuryCashEntry(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const idempotencyKey = requestId(input.requestId);
  const parsed = cashInput(input);
  const fingerprint = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  return inImmediateTransaction(database, () => {
    const replay = database
      .prepare(
        `
      SELECT request_fingerprint,response_json FROM treasury_cash_requests
      WHERE organization_id=? AND request_id=?
    `,
      )
      .get(actor.organizationId, idempotencyKey) as Record<string, unknown> | undefined;
    if (replay) {
      if (String(replay.request_fingerprint) !== fingerprint) {
        throw conflict('REQUEST_ID_REUSED', 'استُخدم معرّف الطلب من قبل لمحتوى مختلف.');
      }
      return { ...JSON.parse(String(replay.response_json)), replayed: true };
    }
    const account = ensureCashAccount(database, actor.organizationId);
    if (Number(account.version) !== parsed.expectedVersion) {
      throw conflict('VERSION_CONFLICT', 'تغير رصيد الفلوس النشطة من جلسة أخرى. حدّث الخزينة.');
    }
    const before = Number(account.balance_units);
    const delta = parsed.direction === 'in' ? parsed.amountUnits : -parsed.amountUnits;
    const after = safeUnits(BigInt(before) + BigInt(delta), 'رصيد الفلوس النشطة');
    const sequence = Number(account.next_sequence);
    const createdAt = nowIso();
    const entryId = randomUUID();
    database
      .prepare(
        `
      INSERT INTO treasury_cash_entries(
        id,organization_id,sequence,direction,amount_units,description,
        balance_before_units,balance_after_units,actor_user_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `,
      )
      .run(
        entryId,
        actor.organizationId,
        sequence,
        parsed.direction,
        parsed.amountUnits,
        parsed.description,
        before,
        after,
        actor.id,
        createdAt,
      );
    const changed = database
      .prepare(
        `
      UPDATE treasury_cash_accounts
      SET balance_units=?,next_sequence=?,version=version+1,updated_at=?
      WHERE organization_id=? AND version=?
    `,
      )
      .run(after, sequence + 1, createdAt, actor.organizationId, parsed.expectedVersion);
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير رصيد الخزينة أثناء التنفيذ.');
    const response = {
      entry: {
        id: entryId,
        sequence,
        direction: parsed.direction,
        amountUnits: parsed.amountUnits,
        description: parsed.description,
        balanceBeforeUnits: before,
        balanceAfterUnits: after,
        actorName: actor.displayName,
        actorIsOwner: Boolean(actor.isOwner),
        createdAt,
      },
      cashVersion: parsed.expectedVersion + 1,
      activeCashUnits: after,
    };
    database
      .prepare(
        `
      INSERT INTO treasury_cash_requests(
        organization_id,request_id,request_fingerprint,response_json,created_at
      ) VALUES(?,?,?,?,?)
    `,
      )
      .run(actor.organizationId, idempotencyKey, fingerprint, JSON.stringify(response), createdAt);
    database
      .prepare(
        `
      INSERT INTO audit_log(
        actor_user_id,organization_id,action,entity_type,entity_id,
        correlation_id,outcome,details_json,created_at
      ) VALUES(?,?,?,?,?,?,'success',?,?)
    `,
      )
      .run(
        actor.id,
        actor.organizationId,
        `treasury.cash.${parsed.direction}`,
        'treasury_cash_entry',
        entryId,
        correlationId,
        JSON.stringify({ amountUnits: parsed.amountUnits, before, after, sequence }),
        createdAt,
      );
    const event = database
      .prepare(
        `
      INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
      VALUES('treasury.changed',?,?,?,?,?)
    `,
      )
      .run(
        actor.organizationId,
        actor.id,
        actor.organizationId,
        JSON.stringify({ sequence, cashVersion: parsed.expectedVersion + 1 }),
        createdAt,
      );
    return { ...response, eventSequence: Number(event.lastInsertRowid), replayed: false };
  });
}
