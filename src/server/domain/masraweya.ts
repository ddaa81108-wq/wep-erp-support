import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { isValidCalendarDate } from './dates.ts';
import { syncEgyptianLinkedAccounts } from './linkedAccounts.ts';

const tripoliDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const businessDate = (value: unknown) => {
  const date = value === undefined || value === '' ? tripoliDate() : String(value);
  if (!isValidCalendarDate(date)) {
    throw badRequest('INVALID_BUSINESS_DATE', 'تاريخ صفحة المصراوية غير صالح.');
  }
  return date;
};

const integerUnits = (value: unknown, field: string, allowNegative = false) => {
  const units = Number(value);
  if (!Number.isSafeInteger(units) || (!allowNegative && units < 0)) {
    throw badRequest('INVALID_MASRAWEYA_VALUE', `${field} يجب أن يكون رقمًا صحيحًا بدون كسور.`);
  }
  return units;
};

const safeTotal = (value: number) => {
  if (!Number.isSafeInteger(value)) {
    throw badRequest('MASRAWEYA_TOTAL_OUT_OF_RANGE', 'إجمالي صفحة المصراوية تجاوز نطاق الحساب الآمن.');
  }
  return value;
};

type DayRow = Record<string, unknown>;

function carryBefore(db: AppDatabase, organizationId: string, date: string) {
  return db.prepare(`
    SELECT business_date AS source_date, previous_value_units + purchases_units - COALESCE((
      SELECT SUM(value_units + commission_units) FROM masraweya_entries WHERE day_id=d.id
    ),0) AS final_units
    FROM masraweya_days d
    WHERE organization_id=? AND status='finalized' AND business_date < ?
    ORDER BY business_date DESC LIMIT 1
  `).get(organizationId,date) as { final_units: number; source_date: string } | undefined;
}

function payload(db: AppDatabase, row: DayRow | undefined, organizationId: string, date: string) {
  const carry = carryBefore(db, organizationId, date);
  const updater = row?.updated_by_user_id ? db.prepare(
    'SELECT display_name,is_owner FROM users WHERE id=? AND organization_id=?',
  ).get(String(row.updated_by_user_id), organizationId) as { display_name: string; is_owner: number } | undefined : undefined;
  const correctionOpener = row?.correction_opened_by_user_id ? db.prepare(
    'SELECT display_name,is_owner FROM users WHERE id=? AND organization_id=?',
  ).get(String(row.correction_opened_by_user_id), organizationId) as { display_name: string; is_owner: number } | undefined : undefined;
  const finalizer = row?.finalized_by_user_id ? db.prepare(
    'SELECT display_name,is_owner FROM users WHERE id=? AND organization_id=?',
  ).get(String(row.finalized_by_user_id), organizationId) as { display_name: string; is_owner: number } | undefined : undefined;
  const entries = row ? db.prepare(`
    SELECT id,sequence,value_units AS valueUnits,commission_units AS commissionUnits
    FROM masraweya_entries WHERE day_id=? ORDER BY sequence
  `).all(String(row.id)) as Array<{id:string;sequence:number;valueUnits:number;commissionUnits:number}> : [];
  const previousValueUnits = row ? Number(row.previous_value_units) : 0;
  const purchasesUnits = row ? Number(row.purchases_units) : 0;
  const workTotalUnits = safeTotal(entries.reduce(
    (sum, entry) => safeTotal(sum + Number(entry.valueUnits) + Number(entry.commissionUnits)),
    0,
  ));
  const finalUnits = safeTotal(previousValueUnits + purchasesUnits - workTotalUnits);
  return {
    id: row ? String(row.id) : null,
    businessDate: date,
    previousValueUnits,
    purchasesUnits,
    workTotalUnits,
    finalUnits,
    carryValueUnits: carry ? Number(carry.final_units) : null,
    carrySourceDate: carry ? String(carry.source_date) : null,
    status: row ? String(row.status) as 'draft'|'finalized' : 'draft' as const,
    version: row ? Number(row.version) : 0,
    updatedAt: row ? String(row.updated_at) : null,
    updatedByName: updater ? String(updater.display_name) : null,
    updatedByIsOwner: updater ? Number(updater.is_owner) === 1 : false,
    finalizedByName: finalizer ? String(finalizer.display_name) : null,
    finalizedByIsOwner: finalizer ? Number(finalizer.is_owner) === 1 : false,
    correctionOpen: row ? Number(row.correction_open) === 1 : false,
    correctionOpenedByName: correctionOpener ? String(correctionOpener.display_name) : null,
    entries,
  };
}

export function getMasraweyaDay(db: AppDatabase, organizationId: string, requestedDate?: unknown) {
  const date = businessDate(requestedDate);
  const row = db.prepare('SELECT * FROM masraweya_days WHERE organization_id=? AND business_date=?')
    .get(organizationId,date) as DayRow | undefined;
  return payload(db, row, organizationId, date);
}

function emitChanged(db: AppDatabase, actorId: string, organizationId: string, date: string, action: string) {
  const result = db.prepare(`INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
    VALUES('masraweya.changed',?,?,?,?,?)`).run(date, actorId, organizationId, JSON.stringify({ action }), nowIso());
  return Number(result.lastInsertRowid);
}

export function saveMasraweyaDay(db: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string) {
  const date = businessDate(input.businessDate);
  const expectedVersion = integerUnits(input.expectedVersion, 'إصدار الصفحة');
  const rows = Array.isArray(input.entries) ? input.entries : [];
  if (rows.length > 500) throw badRequest('TOO_MANY_MASRAWEYA_ROWS', 'الحد الأقصى 500 صف في اليوم.');
  const entries = rows.map((item, index) => {
    if (!item || typeof item !== 'object') throw badRequest('INVALID_MASRAWEYA_ROW', 'أحد صفوف المصراوية غير صالح.');
    const source = item as Record<string, unknown>;
    return {
      sequence: index + 1,
      valueUnits: integerUnits(source.valueUnits, 'القيمة'),
      commissionUnits: integerUnits(source.commissionUnits, 'العمولة'),
    };
  }).filter((entry) => entry.valueUnits !== 0 || entry.commissionUnits !== 0);
  return inImmediateTransaction(db, () => {
    const current = db.prepare('SELECT * FROM masraweya_days WHERE organization_id=? AND business_date=?')
      .get(actor.organizationId,date) as DayRow | undefined;
    if (current && String(current.status) === 'finalized' && Number(current.correction_open) !== 1) {
      throw conflict('MASRAWEYA_DAY_FINALIZED', 'تم اعتماد هذا اليوم ولا يمكن تعديله قبل فتح التعديل.');
    }
    if (Number(current?.version ?? 0) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'تغيرت صفحة المصراوية من جلسة أخرى. حدّث الصفحة.');
    // الترحيل مقصود أن يظل قرارًا يدويًا من الواجهة؛ الخادم لا يغير القيمة السابقة تلقائيًا.
    const previousValueUnits = integerUnits(input.previousValueUnits, 'القيمة السابقة', true);
    const purchasesUnits = integerUnits(input.purchasesUnits, 'مشتريات اليوم');
    const workTotalUnits = entries.reduce(
      (sum, entry) => safeTotal(sum + entry.valueUnits + entry.commissionUnits),
      0,
    );
    safeTotal(previousValueUnits + purchasesUnits - workTotalUnits);
    const changedAt = nowIso();
    const dayId = current ? String(current.id) : randomUUID();
    const nextVersion = expectedVersion + 1;
    if (current) {
      const updated = db.prepare(`UPDATE masraweya_days SET previous_value_units=?,purchases_units=?,exchange_rate_micros=NULL,
        version=?,updated_by_user_id=?,updated_at=? WHERE id=? AND version=?`).run(
        previousValueUnits,purchasesUnits,nextVersion,actor.id,changedAt,dayId,expectedVersion,
      );
      if (Number(updated.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغيرت الصفحة أثناء الحفظ.');
      db.prepare('DELETE FROM masraweya_entries WHERE day_id=?').run(dayId);
    } else {
      db.prepare(`INSERT INTO masraweya_days(id,organization_id,business_date,previous_value_units,purchases_units,exchange_rate_micros,
        status,version,created_by_user_id,updated_by_user_id,created_at,updated_at)
        VALUES(?,?,?,?,?,NULL,'draft',1,?,?,?,?)`).run(
        dayId,actor.organizationId,date,previousValueUnits,purchasesUnits,actor.id,actor.id,changedAt,changedAt,
      );
    }
    const insert = db.prepare(`INSERT INTO masraweya_entries(id,day_id,sequence,value_units,commission_units,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`);
    entries.forEach((entry, index) => insert.run(randomUUID(),dayId,index+1,entry.valueUnits,entry.commissionUnits,changedAt,changedAt));
    db.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,?,'masraweya.save','masraweya_day',?,?,'success',?,?)`).run(
      actor.id,actor.organizationId,dayId,correlationId,JSON.stringify({ businessDate:date,rows:entries.length }),changedAt,
    );
    const eventSequence = emitChanged(db, actor.id, actor.organizationId, date, 'saved');
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    const saved = db.prepare('SELECT * FROM masraweya_days WHERE id=?').get(dayId) as DayRow;
    return { ...payload(db, saved, actor.organizationId, date), eventSequences:[eventSequence, ...linked.eventSequences] };
  });
}

export function finalizeMasraweyaDay(db: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string) {
  const date = businessDate(input.businessDate);
  const expectedVersion = integerUnits(input.expectedVersion, 'إصدار الصفحة');
  return inImmediateTransaction(db, () => {
    const current = db.prepare('SELECT * FROM masraweya_days WHERE organization_id=? AND business_date=?')
      .get(actor.organizationId,date) as DayRow | undefined;
    if (!current) throw notFound('masraweya_day');
    if (String(current.status) === 'finalized' && Number(current.correction_open) !== 1) {
      return { ...payload(db,current,actor.organizationId,date), replayed:true, eventSequences:[] as number[] };
    }
    if (Number(current.version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'تغيرت الصفحة قبل الاعتماد. حدّثها.');
    const finalizedAt = nowIso();
    db.prepare(`UPDATE masraweya_days SET status='finalized',correction_open=0,correction_opened_by_user_id=NULL,correction_opened_at=NULL,
      version=version+1,finalized_by_user_id=?,finalized_at=?,updated_by_user_id=?,updated_at=?
      WHERE id=? AND version=?`).run(actor.id,finalizedAt,actor.id,finalizedAt,String(current.id),expectedVersion);
    db.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,?,'masraweya.finalize','masraweya_day',?,?,'success',?,?)`).run(
      actor.id,actor.organizationId,String(current.id),correlationId,JSON.stringify({ businessDate:date }),finalizedAt,
    );
    const eventSequence = emitChanged(db, actor.id, actor.organizationId, date, 'finalized');
    const linked = syncEgyptianLinkedAccounts(db, actor.organizationId, actor.id);
    const finalized = db.prepare('SELECT * FROM masraweya_days WHERE id=?').get(String(current.id)) as DayRow;
    return { ...payload(db,finalized,actor.organizationId,date), eventSequences:[eventSequence, ...linked.eventSequences] };
  });
}

export function setMasraweyaDayCorrection(
  db: AppDatabase, actor: AuthenticatedUser, input: Record<string, unknown>, correlationId: string,
) {
  const open = input.open === true;
  if (open && actor.isOwner !== true) throw badRequest('OWNER_REQUIRED', 'فتح تعديل يوم معتمد متاح للإدارة العليا فقط.');
  if (actor.role !== 'admin') throw badRequest('ADMIN_REQUIRED', 'إجراء تعديل اليوم متاح للإدارة فقط.');
  const date = businessDate(input.businessDate);
  const expectedVersion = integerUnits(input.expectedVersion, 'إصدار الصفحة');
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (open && reason.length < 2) throw badRequest('CORRECTION_REASON_REQUIRED', 'اكتب سبب فتح التعديل.');
  return inImmediateTransaction(db, () => {
    const current = db.prepare('SELECT * FROM masraweya_days WHERE organization_id=? AND business_date=?')
      .get(actor.organizationId, date) as DayRow | undefined;
    if (!current) throw notFound('masraweya_day');
    if (String(current.status) !== 'finalized') throw conflict('MASRAWEYA_DAY_NOT_FINALIZED', 'اليوم الحالي مفتوح بالفعل.');
    if (Number(current.version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'تغيرت الصفحة من جلسة أخرى. حدّثها.');
    if (open) {
      const other = db.prepare(`SELECT id FROM masraweya_days
        WHERE organization_id=? AND status='finalized' AND correction_open=1 AND id<>?`).get(actor.organizationId, String(current.id));
      if (other) throw conflict('ANOTHER_MASRAWEYA_CORRECTION_OPEN', 'أنه تعديل المصراوية المفتوح أولًا.');
    }
    const at = nowIso();
    const changed = db.prepare(`UPDATE masraweya_days SET correction_open=?,correction_opened_by_user_id=?,
      correction_opened_at=?,version=version+1,updated_by_user_id=?,updated_at=? WHERE id=? AND version=?`)
      .run(open ? 1 : 0, open ? actor.id : null, open ? at : null, actor.id, at, String(current.id), expectedVersion);
    if (Number(changed.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغيرت الصفحة أثناء تنفيذ الطلب.');
    db.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,? ,?, 'masraweya_day', ?, ?, 'success', ?, ?)`).run(
      actor.id, actor.organizationId, open ? 'masraweya.day.correction.open' : 'masraweya.day.correction.close',
      String(current.id), correlationId, JSON.stringify({ businessDate: date, reason }), at,
    );
    const eventSequence = emitChanged(db, actor.id, actor.organizationId, date, open ? 'correction-opened' : 'correction-closed');
    const updated = db.prepare('SELECT * FROM masraweya_days WHERE id=?').get(String(current.id)) as DayRow;
    return { ...payload(db, updated, actor.organizationId, date), eventSequences: [eventSequence] };
  });
}
