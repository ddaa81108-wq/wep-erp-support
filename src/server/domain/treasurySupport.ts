import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';

export type CashDirection = 'in' | 'out';

export function safeUnits(value: bigint, label: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw badRequest('TREASURY_TOTAL_OUT_OF_RANGE', `${label} تجاوز الحد الرقمي الآمن.`);
  }
  return Number(value);
}

export function scalar(database: AppDatabase, sql: string, ...params: Array<string | number | null>) {
  const row = database.prepare(sql).get(...params) as { value: number | null } | undefined;
  return Number(row?.value ?? 0);
}

export function ensureCashAccount(database: AppDatabase, organizationId: string) {
  database
    .prepare(
      `
    INSERT INTO treasury_cash_accounts(organization_id, updated_at)
    VALUES (?, ?) ON CONFLICT(organization_id) DO NOTHING
  `,
    )
    .run(organizationId, nowIso());
  return database
    .prepare(
      `
    SELECT balance_units,next_sequence,version,updated_at
    FROM treasury_cash_accounts WHERE organization_id=?
  `,
    )
    .get(organizationId) as Record<string, unknown>;
}

export function sectionBalance(database: AppDatabase, organizationId: string, sectionKey: string) {
  return scalar(
    database,
    `
    SELECT COALESCE(SUM(current_balance_units),0) AS value
    FROM customers
    WHERE organization_id=? AND section_key=? AND deleted_at IS NULL
  `,
    organizationId,
    sectionKey,
  );
}

export function purchasesBalance(database: AppDatabase, organizationId: string) {
  return scalar(
    database,
    `
    SELECT COALESCE(SUM(d.total_debt_units),0) AS value
    FROM purchase_days d
    WHERE d.organization_id=? AND d.day_number=(
      SELECT MAX(latest.day_number) FROM purchase_days latest
      WHERE latest.organization_id=d.organization_id AND latest.merchant_id=d.merchant_id
    )
  `,
    organizationId,
  );
}

export function egyptianConversion(database: AppDatabase, organizationId: string, egyptianUnits: number) {
  const row = database
    .prepare(
      `
    SELECT source_units_per_target_micros,updated_at
    FROM section_exchange_rates
    WHERE organization_id=? AND section_key='egyptian_deposits'
  `,
    )
    .get(organizationId) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      rate: null,
      convertedUnits: egyptianUnits === 0 ? 0 : null,
      rateUpdatedAt: null,
    };
  }
  const rateMicros = Number(row.source_units_per_target_micros);
  const numerator = BigInt(egyptianUnits) * 1_000_000n;
  const half = BigInt(Math.trunc(rateMicros / 2));
  const converted = safeUnits(
    (numerator >= 0n ? numerator + half : numerator - half) / BigInt(rateMicros),
    'ترحيلات الأمانات المصرية',
  );
  return {
    rate: rateMicros / 1_000_000,
    convertedUnits: converted,
    rateUpdatedAt: String(row.updated_at),
  };
}

export function requestId(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 100 ||
    !/^[a-zA-Z0-9._:-]+$/.test(value)
  ) {
    throw badRequest('INVALID_REQUEST_ID', 'معرّف الطلب غير صالح.');
  }
  return value;
}

export function cashInput(input: Record<string, unknown>) {
  if (input.direction !== 'in' && input.direction !== 'out') {
    throw badRequest('INVALID_CASH_DIRECTION', 'اختر دخول أو خروج.');
  }
  const amountUnits = Number(input.amountUnits);
  if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
    throw badRequest('INVALID_CASH_AMOUNT', 'قيمة حركة النقدية يجب أن تكون رقمًا صحيحًا موجبًا.');
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw badRequest('EXPECTED_VERSION_REQUIRED', 'يلزم إصدار رصيد الفلوس النشطة الحالي.');
  }
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 500) : '';
  return { direction: input.direction as CashDirection, amountUnits, expectedVersion, description };
}
