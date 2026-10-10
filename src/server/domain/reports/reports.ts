import type { AppDatabase } from '../../db/database.ts';
import { inImmediateTransaction, nowIso } from '../../db/database.ts';
import { treasuryDashboard } from '../treasuryQueries.ts';
import { analyzePosition, type PositionSnapshot, type ReportReason } from './reportModel.ts';

const tripoliDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function currentBusinessDate(date = new Date()) {
  return tripoliDate.format(date);
}

function movement(database: AppDatabase, organizationId: string, businessDate: string) {
  const rows = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN section_key IN ('customer_debts','company_debts')
        AND entry_kind='debt' AND source_status='posted' THEN amount_units ELSE 0 END),0) AS receivables_added,
      COALESCE(SUM(CASE WHEN section_key IN ('customer_debts','company_debts')
        AND entry_kind='payment' AND source_status='posted' THEN amount_units ELSE 0 END),0) AS payments,
      COALESCE(SUM(CASE WHEN section_key IN ('purchases','libyan_deposits')
        AND currency='LYD' THEN effect_units ELSE 0 END),0) AS liabilities_effect,
      COALESCE(SUM(CASE WHEN section_key='treasury' AND entry_kind='in'
        AND source_status='posted' THEN amount_units ELSE 0 END),0) AS cash_in,
      COALESCE(SUM(CASE WHEN section_key='treasury' AND entry_kind='out'
        AND source_status='posted' THEN amount_units ELSE 0 END),0) AS cash_out
    FROM financial_ledger_entries
    WHERE organization_id=? AND date(occurred_at, '+2 hours')=?
  `).get(organizationId, businessDate) as Record<string, unknown>;
  return {
    receivablesAddedUnits: Number(rows.receivables_added),
    paymentsUnits: Number(rows.payments),
    liabilitiesEffectUnits: Number(rows.liabilities_effect),
    cashInUnits: Number(rows.cash_in),
    cashOutUnits: Number(rows.cash_out),
  };
}

type StoredRow = Record<string, unknown>;

function rowSnapshot(row: StoredRow | undefined): PositionSnapshot | null {
  if (!row) return null;
  return {
    receivablesUnits: Number(row.receivables_units),
    liabilitiesUnits: Number(row.liabilities_units),
    activeCashUnits: Number(row.active_cash_units),
    egyptianSourceUnits: Number(row.egyptian_source_units),
    egyptianConvertedUnits: row.egyptian_converted_units === null ? null : Number(row.egyptian_converted_units),
    egyptianRate: row.egyptian_rate === null ? null : Number(row.egyptian_rate),
    netUnits: row.net_units === null ? null : Number(row.net_units),
  };
}

function mapRow(row: StoredRow) {
  const snapshot = rowSnapshot(row)!;
  const reasons = JSON.parse(String(row.reasons_json)) as ReportReason[];
  return {
    businessDate: String(row.business_date),
    ...snapshot,
    daily: {
      receivablesAddedUnits: Number(row.daily_receivables_added_units),
      paymentsUnits: Number(row.daily_payments_units),
      liabilitiesEffectUnits: Number(row.daily_liabilities_effect_units),
      cashInUnits: Number(row.daily_cash_in_units),
      cashOutUnits: Number(row.daily_cash_out_units),
    },
    status: String(row.status),
    summary: String(row.summary),
    reasons,
    version: Number(row.version),
    generatedAt: String(row.generated_at),
    updatedAt: String(row.updated_at),
    isFinalized: Number(row.is_finalized) === 1,
    finalizedAt: row.finalized_at === null ? null : String(row.finalized_at),
  };
}

export function finalizePastReports(
  database: AppDatabase,
  organizationId: string,
  today = currentBusinessDate(),
) {
  return inImmediateTransaction(database, () => {
    const openRows = database.prepare(`
      SELECT business_date FROM daily_financial_reports
      WHERE organization_id=? AND business_date<? AND is_finalized=0
      ORDER BY business_date
    `).all(organizationId, today) as Array<{ business_date: string }>;
    if (!openRows.length) return 0;
    const update = database.prepare(`
      UPDATE daily_financial_reports SET
        daily_receivables_added_units=?,daily_payments_units=?,
        daily_liabilities_effect_units=?,daily_cash_in_units=?,daily_cash_out_units=?,
        is_finalized=1,finalized_at=?,updated_at=?,version=version+1
      WHERE organization_id=? AND business_date=? AND is_finalized=0
    `);
    const finalizedAt = nowIso();
    for (const row of openRows) {
      const daily = movement(database, organizationId, String(row.business_date));
      update.run(
        daily.receivablesAddedUnits,
        daily.paymentsUnits,
        daily.liabilitiesEffectUnits,
        daily.cashInUnits,
        daily.cashOutUnits,
        finalizedAt,
        finalizedAt,
        organizationId,
        String(row.business_date),
      );
    }
    return openRows.length;
  });
}

export function refreshDailyReport(
  database: AppDatabase,
  organizationId: string,
  businessDate = currentBusinessDate(),
) {
  const stored = database.prepare(`
    SELECT * FROM daily_financial_reports WHERE organization_id=? AND business_date=?
  `).get(organizationId, businessDate) as StoredRow | undefined;
  if (stored && Number(stored.is_finalized) === 1) return mapRow(stored);
  const dashboard = treasuryDashboard(database, organizationId);
  const current: PositionSnapshot = {
    receivablesUnits: dashboard.receivablesUnits,
    liabilitiesUnits: dashboard.liabilitiesUnits,
    activeCashUnits: dashboard.activeCashUnits,
    egyptianSourceUnits: dashboard.egyptianSourceUnits,
    egyptianConvertedUnits: dashboard.egyptianConvertedUnits,
    egyptianRate: dashboard.egyptianRate,
    netUnits: dashboard.netUnits,
  };
  const previousRows = database.prepare(`
    SELECT * FROM daily_financial_reports
    WHERE organization_id=? AND business_date<? ORDER BY business_date DESC LIMIT 8
  `).all(organizationId, businessDate) as StoredRow[];
  const previous = rowSnapshot(previousRows[0]);
  const recentAbsoluteChanges: number[] = [];
  for (let index = 0; index < previousRows.length - 1; index += 1) {
    const first = rowSnapshot(previousRows[index]);
    const second = rowSnapshot(previousRows[index + 1]);
    if (first?.netUnits !== null && second?.netUnits !== null) {
      recentAbsoluteChanges.push(Math.abs((first?.netUnits ?? 0) - (second?.netUnits ?? 0)));
    }
  }
  const analysis = analyzePosition(current, previous, recentAbsoluteChanges);
  const daily = movement(database, organizationId, businessDate);
  const now = nowIso();
  const values = [
    current.receivablesUnits, current.liabilitiesUnits, current.activeCashUnits,
    current.egyptianSourceUnits, current.egyptianConvertedUnits, current.egyptianRate,
    current.netUnits, daily.receivablesAddedUnits, daily.paymentsUnits,
    daily.liabilitiesEffectUnits, daily.cashInUnits, daily.cashOutUnits,
    analysis.status, analysis.summary, JSON.stringify(analysis.reasons),
  ] as const;
  const existing = stored;
  const comparable = existing && [
    existing.receivables_units, existing.liabilities_units, existing.active_cash_units,
    existing.egyptian_source_units, existing.egyptian_converted_units, existing.egyptian_rate,
    existing.net_units, existing.daily_receivables_added_units, existing.daily_payments_units,
    existing.daily_liabilities_effect_units, existing.daily_cash_in_units, existing.daily_cash_out_units,
    existing.status, existing.summary, existing.reasons_json,
  ];
  if (!existing) {
    database.prepare(`
      INSERT INTO daily_financial_reports(
        organization_id,business_date,receivables_units,liabilities_units,active_cash_units,
        egyptian_source_units,egyptian_converted_units,egyptian_rate,net_units,
        daily_receivables_added_units,daily_payments_units,daily_liabilities_effect_units,
        daily_cash_in_units,daily_cash_out_units,status,summary,reasons_json,
        version,generated_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).run(organizationId, businessDate, ...values, now, now);
  } else if (JSON.stringify(comparable) !== JSON.stringify(values)) {
    database.prepare(`
      UPDATE daily_financial_reports SET
        receivables_units=?,liabilities_units=?,active_cash_units=?,egyptian_source_units=?,
        egyptian_converted_units=?,egyptian_rate=?,net_units=?,daily_receivables_added_units=?,
        daily_payments_units=?,daily_liabilities_effect_units=?,daily_cash_in_units=?,daily_cash_out_units=?,
        status=?,summary=?,reasons_json=?,version=version+1,updated_at=?
      WHERE organization_id=? AND business_date=?
    `).run(...values, now, organizationId, businessDate);
  }
  return mapRow(database.prepare(`
    SELECT * FROM daily_financial_reports WHERE organization_id=? AND business_date=?
  `).get(organizationId, businessDate) as StoredRow);
}

export function reportsDashboard(database: AppDatabase, organizationId: string, url: URL) {
  refreshDailyReport(database, organizationId);
  const requested = Number(url.searchParams.get('limit') ?? 30);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 366) : 30;
  const total = Number((database.prepare(`
    SELECT COUNT(*) AS count FROM daily_financial_reports WHERE organization_id=?
  `).get(organizationId) as { count: number }).count);
  const rows = database.prepare(`
    SELECT * FROM daily_financial_reports WHERE organization_id=?
    ORDER BY business_date DESC LIMIT ?
  `).all(organizationId, limit) as StoredRow[];
  const items = rows.map((row, index) => ({ sequence: total - index, ...mapRow(row) }));
  return { current: items[0] ?? null, items, methodology: {
    formula: 'الديون لنا + الأموال النشطة + المصري المحول - الديون علينا',
    note: 'التغير المعروض هو تغير المركز المالي وليس ربحًا محاسبيًا معتمدًا.',
    currency: 'LYD' as const,
  } };
}
