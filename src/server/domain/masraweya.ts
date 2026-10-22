import { randomUUID } from 'node:crypto';
import { warnDuplicate } from './duplicateWarning.ts';
import { inImmediateTransaction, nowIso, type AppDatabase } from '../db/database.ts';
import { badRequest, conflict, forbidden } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { syncEgyptianLinkedAccounts } from './linkedAccounts.ts';
import { masraweyaDate, masraweyaEditWindow } from './masraweyaCalendar.ts';

type DayRow = Record<string, unknown>;
type Entry = { id: string; sequence: number; valueUnits: number; commissionUnits: number };
function units(value: unknown, signed = false) {
  if (typeof value !== 'number') throw badRequest('INVALID_MASRAWEYA_VALUE', 'أدخل قيمة رقمية صحيحة.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || (!signed && n < 0))
    throw badRequest('INVALID_MASRAWEYA_VALUE', 'أدخل قيمة صحيحة بدون كسور وفي النطاق المسموح.');
  return n;
}
function safe(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
    throw badRequest('MASRAWEYA_TOTAL_OUT_OF_RANGE', 'إجمالي المصراوية تجاوز نطاق الحساب الآمن.');
  return Number(value);
}
function carryBefore(db: AppDatabase, organization: string, date: string) {
  return db
    .prepare(
      `SELECT business_date AS source_date, previous_value_units+purchases_units-
    COALESCE((SELECT SUM(value_units+commission_units) FROM masraweya_entries WHERE day_id=d.id),0) AS final_units
    FROM masraweya_days d WHERE organization_id=? AND business_date<? ORDER BY business_date DESC LIMIT 1`,
    )
    .get(organization, date) as { source_date: string; final_units: number } | undefined;
}
export function getMasraweyaDay(db: AppDatabase, organization: string, requestedDate?: unknown) {
  const date = masraweyaDate(requestedDate);
  const row = db
    .prepare('SELECT * FROM masraweya_days WHERE organization_id=? AND business_date=?')
    .get(organization, date) as DayRow | undefined;
  const carry = carryBefore(db, organization, date);
  const first = db
    .prepare(
      'SELECT business_date FROM masraweya_days WHERE organization_id=? ORDER BY business_date LIMIT 1',
    )
    .get(organization) as { business_date: string } | undefined;
  const entries = row
    ? (db
        .prepare(
          `SELECT id,sequence,value_units AS valueUnits,commission_units AS commissionUnits
    FROM masraweya_entries WHERE day_id=? ORDER BY sequence`,
        )
        .all(String(row.id)) as Entry[])
    : [];
  const previousValueUnits = row ? Number(row.previous_value_units) : Number(carry?.final_units ?? 0);
  const purchasesUnits = Number(row?.purchases_units ?? 0);
  const workTotalUnits = safe(
    entries.reduce((sum, entry) => sum + BigInt(entry.valueUnits) + BigInt(entry.commissionUnits), 0n),
  );
  const updater = row?.updated_by_user_id
    ? (db
        .prepare('SELECT display_name,is_owner FROM users WHERE id=? AND organization_id=?')
        .get(String(row.updated_by_user_id), organization) as
        { display_name: string; is_owner: number } | undefined)
    : undefined;
  return {
    id: row ? String(row.id) : null,
    businessDate: date,
    ...masraweyaEditWindow(date),
    previousValueUnits,
    purchasesUnits,
    workTotalUnits,
    finalUnits: safe(BigInt(previousValueUnits) + BigInt(purchasesUnits) - BigInt(workTotalUnits)),
    carryValueUnits: carry?.final_units ?? null,
    carrySourceDate: carry?.source_date ?? null,
    openingEditable: !carry && (!first || first.business_date === date),
    historicalAdjustmentUnits: Number(row?.carry_adjustment_units ?? 0),
    version: Number(row?.version ?? 0),
    updatedAt: row ? String(row.updated_at) : null,
    updatedByName: updater?.display_name ?? null,
    updatedByIsOwner: updater?.is_owner === 1,
    entries,
  };
}

export function saveMasraweyaDay(
  db: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
) {
  if (actor.role !== 'admin' && !actor.permissions.has('masraweya.write')) throw forbidden('masraweya.write');
  const date = masraweyaDate(input.businessDate);
  const window = masraweyaEditWindow(date);
  if (!window.editable)
    throw conflict(
      'MASRAWEYA_DATE_LOCKED',
      'التعديل متاح لليوم الحالي وآخر سبعة أيام فقط؛ المستقبل والأيام الأقدم للقراءة.',
    );
  const expectedVersion = units(input.expectedVersion);
  const purchases = units(input.purchasesUnits);
  if (!Array.isArray(input.entries) || input.entries.length > 500)
    throw badRequest('INVALID_MASRAWEYA_ROWS', 'يلزم جدول لا يزيد عن 500 صف.');
  const entries = input.entries
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object')
        throw badRequest('INVALID_MASRAWEYA_ROW', 'أحد الصفوف غير صالح.');
      const row = item as Record<string, unknown>;
      return {
        sequence: index + 1,
        valueUnits: units(row.valueUnits),
        commissionUnits: units(row.commissionUnits),
      };
    })
    .filter((row) => row.valueUnits !== 0 || row.commissionUnits !== 0);
  const work = safe(
    entries.reduce((sum, row) => sum + BigInt(row.valueUnits) + BigInt(row.commissionUnits), 0n),
  );
  return inImmediateTransaction(db, () => {
    const before = getMasraweyaDay(db, actor.organizationId, date);
    const previous =
      input.previousValueUnits === undefined
        ? before.previousValueUnits
        : units(input.previousValueUnits, true);
    if (previous !== before.previousValueUnits && !before.openingEditable)
      throw conflict(
        'MASRAWEYA_OPENING_AUTOMATIC',
        'القيمة السابقة مرتبطة باليوم السابق؛ صحح اليوم المصدر بدل تغييرها هنا.',
      );
    const afterBalance = safe(BigInt(previous) + BigInt(purchases) - BigInt(work));
    const sameEntries =
      JSON.stringify(entries) ===
      JSON.stringify(
        before.entries.map(({ sequence, valueUnits, commissionUnits }) => ({
          sequence,
          valueUnits,
          commissionUnits,
        })),
      );
    if (
      before.id &&
      previous === before.previousValueUnits &&
      purchases === before.purchasesUnits &&
      sameEntries
    )
      return { ...before, eventSequences: [] as number[], replayed: true };
    if (before.version !== expectedVersion)
      throw conflict(
        'VERSION_CONFLICT',
        'تغيرت الصفحة من جلسة أخرى أو تصحح رصيد يوم سابق. مسودتك باقية؛ راجع النسخة المحفوظة.',
      );
    warnDuplicate(input, () => date === window.today && entries.some(row => {
      const previousRow = before.entries.find(old => old.sequence === row.sequence);
      if (previousRow?.valueUnits === row.valueUnits && previousRow.commissionUnits === row.commissionUnits) return false;
      return entries.some(other => other.sequence !== row.sequence && other.valueUnits === row.valueUnits
        && other.commissionUnits === row.commissionUnits);
    }));
    const at = nowIso();
    const id = before.id ?? randomUUID();
    if (before.id) {
      db.prepare(
        `UPDATE masraweya_days SET previous_value_units=?,purchases_units=?,carry_adjustment_units=?,version=version+1,
        updated_by_user_id=?,updated_at=? WHERE id=?`,
      ).run(
        previous,
        purchases,
        before.openingEditable ? previous : before.historicalAdjustmentUnits,
        actor.id,
        at,
        id,
      );
    } else {
      db.prepare(
        `INSERT INTO masraweya_days(id,organization_id,business_date,previous_value_units,purchases_units,
        carry_adjustment_units,status,version,created_by_user_id,updated_by_user_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'draft',1,?,?,?,?)`,
      ).run(
        id,
        actor.organizationId,
        date,
        previous,
        purchases,
        before.openingEditable ? previous : 0,
        actor.id,
        actor.id,
        at,
        at,
      );
    }
    // Keep unchanged row IDs and empty positions; only changed rows touch the ledger.
    const oldBySequence = new Map(before.entries.map((row) => [row.sequence, row]));
    const newSequences = new Set(entries.map((row) => row.sequence));
    for (const old of before.entries)
      if (!newSequences.has(old.sequence))
        db.prepare('DELETE FROM masraweya_entries WHERE id=? AND day_id=?').run(old.id, id);
    for (const entry of entries) {
      const old = oldBySequence.get(entry.sequence);
      if (!old)
        db.prepare(
          `INSERT INTO masraweya_entries(id,day_id,sequence,value_units,commission_units,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`,
        ).run(randomUUID(), id, entry.sequence, entry.valueUnits, entry.commissionUnits, at, at);
      else if (old.valueUnits !== entry.valueUnits || old.commissionUnits !== entry.commissionUnits)
        db.prepare(
          'UPDATE masraweya_entries SET value_units=?,commission_units=?,updated_at=? WHERE id=?',
        ).run(entry.valueUnits, entry.commissionUnits, at, old.id);
    }
    const delta = BigInt(afterBalance) - BigInt(before.finalUnits);
    const affectedDates: string[] = [];
    if (delta !== 0n) {
      const later = db
        .prepare(
          `SELECT id,business_date,previous_value_units,purchases_units,
        COALESCE((SELECT SUM(value_units+commission_units) FROM masraweya_entries WHERE day_id=d.id),0) AS work
        FROM masraweya_days d WHERE organization_id=? AND business_date>? ORDER BY business_date`,
        )
        .all(actor.organizationId, date);
      for (const day of later) {
        const opening = safe(BigInt(String(day.previous_value_units)) + delta);
        safe(BigInt(opening) + BigInt(String(day.purchases_units)) - BigInt(String(day.work)));
        db.prepare('UPDATE masraweya_days SET previous_value_units=?,version=version+1 WHERE id=?').run(
          opening,
          String(day.id),
        );
        affectedDates.push(String(day.business_date));
      }
    }
    db.prepare(
      `INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,?,'masraweya.save','masraweya_day',?,?,'success',?,?)`,
    ).run(
      actor.id,
      actor.organizationId,
      id,
      correlationId,
      JSON.stringify({
        businessDate: date,
        before: {
          previousValueUnits: before.previousValueUnits,
          purchasesUnits: before.purchasesUnits,
          entries: before.entries,
        },
        after: { previousValueUnits: previous, purchasesUnits: purchases, entries },
        affectedDates,
        balanceDelta: delta.toString(),
      }),
      at,
    );
    const event = db
      .prepare(
        `INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
      VALUES('masraweya.changed',?,?,?,?,?)`,
      )
      .run(date, actor.id, actor.organizationId, JSON.stringify({ action: 'saved', affectedDates }), at);
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    return {
      ...getMasraweyaDay(db, actor.organizationId, date),
      replayed: false,
      eventSequences: [Number(event.lastInsertRowid), ...linked.eventSequences],
    };
  });
}
