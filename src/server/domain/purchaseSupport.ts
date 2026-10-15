import { createHash, randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

export type PurchaseMerchantKey = 'al_bayan' | 'simsim';
export const MERCHANTS: Record<PurchaseMerchantKey, string> = { al_bayan: 'البيان', simsim: 'سمسم' };
const ITEMS = new Map([
  ['vodafone_cash', 'فودافون كاش'],
  ['kafr_el_sheikh', 'كفر الشيخ'],
  ['cairo', 'القاهرة'],
  ['mansoura', 'المنصورة'],
  ['fawry', 'فوري'],
  ['banks', 'بنوك'],
]);

export const integer = (value: unknown, field: string, negative = false) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || (!negative && result < 0)) {
    throw badRequest('INVALID_PURCHASE_VALUE', `${field} يجب أن يكون رقمًا صحيحًا بدون كسور.`);
  }
  return result;
};
const safeInteger = (value: bigint, field: string) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw badRequest('PURCHASE_TOTAL_OUT_OF_RANGE', `${field} تجاوز نطاق الحساب الآمن.`);
  }
  return Number(value);
};
export const merchantKey = (value: unknown): PurchaseMerchantKey => {
  if (value !== 'al_bayan' && value !== 'simsim') throw notFound('purchase_merchant');
  return value;
};
export const requestId = (value: unknown) => {
  const id = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw badRequest('INVALID_REQUEST_ID', 'معرّف الطلب غير صالح.');
  return id;
};
const tripoliDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tripoli',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export function exchangeRateMicros(value: unknown) {
  const source = String(value ?? '').trim();
  if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(source))
    throw badRequest('INVALID_EXCHANGE_RATE', 'سعر الصرف غير صالح.');
  const [whole, fraction = ''] = source.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER))
    throw badRequest('INVALID_EXCHANGE_RATE', 'سعر الصرف غير صالح.');
  return Number(result);
}

export function roundedResult(value: number, micros: number, mode: unknown) {
  const operation = mode === 'multiply' || mode === 'divide' ? mode : null;
  if (!operation) throw badRequest('INVALID_PURCHASE_OPERATION', 'العملية يجب أن تكون ضرب أو قسمة.');
  const numerator = operation === 'multiply' ? BigInt(value) * BigInt(micros) : BigInt(value) * 1_000_000n;
  const denominator = operation === 'multiply' ? 1_000_000n : BigInt(micros);
  return { operation, result: safeInteger((numerator + denominator / 2n) / denominator, 'ناتج التحويل') };
}

export function normalized(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();
}
export function item(input: Record<string, unknown>) {
  const requestedCode = String(input.itemCode ?? 'custom');
  let label = String(input.itemLabel ?? ITEMS.get(requestedCode) ?? '')
    .trim()
    .slice(0, 80);
  if (!label) throw badRequest('INVALID_PURCHASE_ITEM', 'نوع المشتريات مطلوب.');
  const compact = normalized(label).replace(/ /g, '');
  const isVodafone =
    requestedCode === 'vodafone_cash' ||
    ['فودافون', 'فودافونكاش', 'فودا', 'vodafone', 'vodafonecash', 'voda'].includes(compact);
  const code = isVodafone ? 'vodafone_cash' : ITEMS.has(requestedCode) ? requestedCode : 'custom';
  if (code !== 'custom') label = ITEMS.get(code) ?? label;
  return { code, label };
}

export function parseEntry(input: Record<string, unknown>) {
  const egpValueUnits = integer(input.egpValueUnits, 'القيمة بالجنيه المصري');
  const rateMicros = exchangeRateMicros(input.exchangeRate);
  const { operation, result } = roundedResult(egpValueUnits, rateMicros, input.calculationMode);
  const paidUnits = integer(input.paidUnits, 'المسدد');
  const selectedItem = item(input);
  const vodafoneConsumedUnits = integer(input.vodafoneConsumedUnits, 'مستهلك فودافون');
  return {
    ...selectedItem,
    egpValueUnits,
    rateMicros,
    operation,
    result,
    paidUnits,
    remaining: safeInteger(BigInt(result) - BigInt(paidUnits), 'الباقي'),
    vodafoneConsumedUnits,
  };
}

export function ensureMerchant(
  db: AppDatabase,
  organizationId: string,
  key: PurchaseMerchantKey,
  actorId: string,
) {
  let row = db
    .prepare('SELECT * FROM purchase_merchants WHERE organization_id=? AND merchant_key=?')
    .get(organizationId, key) as Record<string, unknown> | undefined;
  if (!row) {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO purchase_merchants(id,organization_id,merchant_key,display_name,created_at) VALUES(?,?,?,?,?)',
    ).run(id, organizationId, key, MERCHANTS[key], nowIso());
    row = db.prepare('SELECT * FROM purchase_merchants WHERE id=?').get(id) as Record<string, unknown>;
  }
  ensureOpenDay(db, organizationId, row, actorId);
  return row;
}

export function ensureOpenDay(
  db: AppDatabase,
  organizationId: string,
  merchant: Record<string, unknown>,
  actorId: string,
) {
  const existing = db
    .prepare("SELECT * FROM purchase_days WHERE organization_id=? AND merchant_id=? AND status='draft'")
    .get(organizationId, String(merchant.id));
  if (existing) return existing as Record<string, unknown>;
  const previous = db
    .prepare(
      "SELECT total_debt_units,vodafone_remaining_units FROM purchase_days WHERE organization_id=? AND merchant_id=? AND status='finalized' ORDER BY day_number DESC LIMIT 1",
    )
    .get(organizationId, String(merchant.id)) as Record<string, unknown> | undefined;
  const counter = db
    .prepare('SELECT next_day_number FROM purchase_merchants WHERE id=? AND organization_id=?')
    .get(String(merchant.id), organizationId) as { next_day_number: number };
  const dayNumber = Number(counter.next_day_number);
  const previousDebt = Number(previous?.total_debt_units ?? 0);
  const previousVodafone = Number(previous?.vodafone_remaining_units ?? 0);
  const at = nowIso();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO purchase_days(id,organization_id,merchant_id,day_number,business_date,previous_debt_units,
    previous_vodafone_units,total_debt_units,vodafone_remaining_units,created_by_user_id,opened_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    organizationId,
    String(merchant.id),
    dayNumber,
    tripoliDate(),
    previousDebt,
    previousVodafone,
    previousDebt,
    previousVodafone,
    actorId,
    at,
    at,
  );
  db.prepare('UPDATE purchase_merchants SET next_day_number=next_day_number+1 WHERE id=?').run(
    String(merchant.id),
  );
  return db.prepare('SELECT * FROM purchase_days WHERE id=?').get(id) as Record<string, unknown>;
}

export function recalculate(db: AppDatabase, dayId: string, expectedVersion: number) {
  const day = db.prepare('SELECT * FROM purchase_days WHERE id=?').get(dayId) as
    Record<string, unknown> | undefined;
  if (!day) throw notFound('purchase_day');
  if (String(day.status) !== 'draft' && Number(day.correction_open) !== 1)
    throw conflict('PURCHASE_DAY_FINALIZED', 'افتح تعديل اليوم المرحّل أولًا.');
  if (Number(day.version) !== expectedVersion)
    throw conflict('VERSION_CONFLICT', 'تغير سجل المشتريات من جلسة أخرى. حدّث البيانات.');
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(result_units),0) result,COALESCE(SUM(paid_units),0) paid,
    COALESCE(SUM(CASE WHEN item_code='vodafone_cash' THEN egp_value_units ELSE 0 END),0) vodafone,
    COALESCE(SUM(vodafone_consumed_units),0) consumed FROM purchase_entries WHERE day_id=? AND deleted_at IS NULL`,
    )
    .get(dayId) as Record<string, unknown>;
  const result = integer(totals.result, 'إجمالي اليوم');
  const paid = integer(totals.paid, 'إجمالي المسدد');
  const vodafone = integer(totals.vodafone, 'إجمالي فودافون');
  const consumed = integer(totals.consumed, 'إجمالي المستهلك');
  const oldDebt = Number(day.total_debt_units),
    oldVodafone = Number(day.vodafone_remaining_units);
  const debt = safeInteger(
    BigInt(Number(day.previous_debt_units)) + BigInt(result) - BigInt(paid),
    'إجمالي الديون',
  );
  const remainingVodafone = safeInteger(
    BigInt(Number(day.previous_vodafone_units)) + BigInt(vodafone) - BigInt(consumed),
    'باقي فودافون',
  );
  const at = nowIso();
  const updated = db
    .prepare(
      `UPDATE purchase_days SET today_result_units=?,today_paid_units=?,today_vodafone_value_units=?,
    today_vodafone_consumed_units=?,total_debt_units=?,vodafone_remaining_units=?,version=version+1,updated_at=? WHERE id=? AND version=?`,
    )
    .run(result, paid, vodafone, consumed, debt, remainingVodafone, at, dayId, expectedVersion);
  if (Number(updated.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير سجل المشتريات أثناء الحفظ.');
  const debtDelta = debt - oldDebt,
    vodafoneDelta = remainingVodafone - oldVodafone;
  if ((debtDelta !== 0 || vodafoneDelta !== 0) && String(day.status) === 'finalized') {
    db.prepare(
      `UPDATE purchase_days SET previous_debt_units=previous_debt_units+?,total_debt_units=total_debt_units+?,
      previous_vodafone_units=previous_vodafone_units+?,vodafone_remaining_units=vodafone_remaining_units+?,version=version+1,updated_at=?
      WHERE organization_id=? AND merchant_id=? AND day_number>?`,
    ).run(
      debtDelta,
      debtDelta,
      vodafoneDelta,
      vodafoneDelta,
      at,
      String(day.organization_id),
      String(day.merchant_id),
      Number(day.day_number),
    );
  }
}

export function event(db: AppDatabase, actor: AuthenticatedUser, merchantId: string, action: string) {
  return Number(
    db
      .prepare(
        `INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
    VALUES('purchases.changed',?,?,?,?,?)`,
      )
      .run(merchantId, actor.id, actor.organizationId, JSON.stringify({ action }), nowIso()).lastInsertRowid,
  );
}
export function audit(
  db: AppDatabase,
  actor: AuthenticatedUser,
  action: string,
  id: string,
  correlationId: string,
  details: object,
) {
  db.prepare(
    `INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
    VALUES(?,?,?,'purchase_entry',?,?,'success',?,?)`,
  ).run(actor.id, actor.organizationId, action, id, correlationId, JSON.stringify(details), nowIso());
}

export function mapDay(day: Record<string, unknown>) {
  return {
    id: String(day.id),
    dayNumber: Number(day.day_number),
    businessDate: String(day.business_date),
    status: String(day.status),
    previousDebtUnits: Number(day.previous_debt_units),
    previousVodafoneUnits: Number(day.previous_vodafone_units),
    todayResultUnits: Number(day.today_result_units),
    todayPaidUnits: Number(day.today_paid_units),
    totalDebtUnits: Number(day.total_debt_units),
    vodafoneRemainingUnits: Number(day.vodafone_remaining_units),
    version: Number(day.version),
    correctionOpen: Number(day.correction_open) === 1,
  };
}
export function mapEntry(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    dayId: String(row.day_id),
    sequence: Number(row.sequence),
    dayNumber: Number(row.day_number),
    businessDate: String(row.business_date),
    dayStatus: String(row.day_status),
    dayClosingDebtUnits: Number(row.day_closing_debt_units),
    itemCode: String(row.item_code),
    itemLabel: String(row.item_label),
    egpValueUnits: Number(row.egp_value_units),
    calculationMode: String(row.calculation_mode),
    exchangeRate: Number(row.exchange_rate_micros) / 1_000_000,
    resultUnits: Number(row.result_units),
    paidUnits: Number(row.paid_units),
    remainingUnits: Number(row.remaining_units),
    vodafoneConsumedUnits: Number(row.vodafone_consumed_units),
    actorName: String(row.actor_name),
    actorIsOwner: Number(row.actor_is_owner) === 1,
    version: Number(row.version),
    dayVersion: Number(row.day_version),
    correctionOpen: Number(row.correction_open) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function requestFingerprint(
  operation: string,
  merchant: PurchaseMerchantKey,
  resource: string,
  payload: object,
) {
  return createHash('sha256')
    .update(JSON.stringify({ operation, merchant, resource, payload }))
    .digest('hex');
}
export function replay(
  db: AppDatabase,
  organizationId: string,
  id: string,
  operation: string,
  fingerprint: string,
) {
  const row = db
    .prepare(
      'SELECT operation,request_fingerprint,response_json FROM purchase_requests WHERE organization_id=? AND request_id=?',
    )
    .get(organizationId, id) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (
    String(row.operation) !== operation ||
    (row.request_fingerprint !== null && String(row.request_fingerprint) !== fingerprint)
  ) {
    throw conflict('REQUEST_ID_REUSED', 'تم استخدام معرّف الطلب لعملية أو بيانات مختلفة.');
  }
  return { ...JSON.parse(String(row.response_json)), replayed: true, eventSequences: [] as number[] };
}
export function remember(
  db: AppDatabase,
  organizationId: string,
  id: string,
  operation: string,
  fingerprint: string,
  response: object,
) {
  db.prepare(
    'INSERT INTO purchase_requests(organization_id,request_id,operation,request_fingerprint,response_json,created_at) VALUES(?,?,?,?,?,?)',
  ).run(organizationId, id, operation, fingerprint, JSON.stringify(response), nowIso());
}
