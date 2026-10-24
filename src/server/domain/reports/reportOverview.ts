import type { AppDatabase } from '../../db/database.ts';
import type { ReportActivityGroup, ReportOverview, ReportSource, ReportSourceKey } from '../../../shared/reportOverview.ts';
import { badRequest } from '../../http/errors.ts';
import { egyptianConversion, safeUnits } from '../treasurySupport.ts';
import { businessDayRange, currentBusinessDate, organizationTimezone } from './businessDates.ts';
import { readFiveAmClosing } from './fiveAmClosing.ts';
import { componentReasons, type PositionSnapshot } from './reportModel.ts';

const sections: Record<string, ReportSourceKey> = {
  customer_debts: 'customers', company_debts: 'companies', libyan_deposits: 'libyan', egyptian_deposits: 'egyptian',
};
const activitySections: Record<Exclude<ReportActivityGroup, 'all'>, string> = {
  customers: 'customer_debts', companies: 'company_debts', libyan: 'libyan_deposits',
  egyptian: 'egyptian_deposits', purchases: 'purchases', cash: 'treasury',
};
type Row = Record<string, unknown>;
function sum(rows: Row[], key: string) {
  return safeUnits(rows.reduce((total, row) => total + BigInt(String(row[key] ?? 0)), 0n), 'إجمالي التقرير');
}
function bigRows(db: AppDatabase, sql: string, ...parameters: (string | number)[]) {
  const query = db.prepare(sql);
  query.setReadBigInts(true);
  return query.all(...parameters) as Row[];
}
// Derive account movement money from its integer source, not a SQL multiplication cache.
function sourceMoney(row: Row): Row {
  if (row.source_kind !== 'debt_transaction' || row.source_amount === null || row.source_amount === undefined) return row;
  const amount = BigInt(String(row.source_amount)) * BigInt(String(row.source_rate)) / 1_000_000n;
  return { ...row, amount_units: amount, effect_units: row.entry_kind === 'payment' ? -amount : amount };
}
/** One consistent, deferred read snapshot. No migrations, cache writes or source initialization. */
function readSnapshot<T>(db: AppDatabase, read: () => T): T {
  const nested = db.isTransaction;
  if (!nested) db.exec('BEGIN');
  try {
    const result = read();
    if (!nested) db.exec('COMMIT');
    return result;
  } catch (error) {
    if (!nested) db.exec('ROLLBACK');
    throw error;
  }
}
function day(db: AppDatabase, organizationId: string, now: Date) {
  const timezone = organizationTimezone(db, organizationId);
  const businessDate = currentBusinessDate(now, timezone);
  return { timezone, businessDate, ...businessDayRange(businessDate, timezone) };
}
const liveLedger = `f.source_status NOT IN ('deleted','cancelled','pending','rejected')`;

export function reportOverview(db: AppDatabase, organizationId: string, now = new Date()): ReportOverview {
  return readSnapshot(db, () => {
    const range = day(db, organizationId, now);
    const accounts = bigRows(db, `SELECT section_key,current_balance_units,system_link_key FROM customers
      WHERE organization_id=? AND deleted_at IS NULL`, organizationId);
    const sources: ReportSource[] = [
      { key: 'customers', label: 'حسابات العملاء', currency: 'LYD', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'صافي أرصدة العملاء؛ الرصيد الدائن يُخصم من الإجمالي.' },
      { key: 'companies', label: 'حسابات الشركات', currency: 'LYD', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'صافي أرصدة الشركات؛ لا يُضاف التحصيل مرة ثانية.' },
      { key: 'libyan', label: 'الأمانات الليبية', currency: 'LYD', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'صافي رصيد الأمانات بالدينار وفق دفتر القسم.' },
      { key: 'egyptian', label: 'الأمانات المصرية', currency: 'EGP', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'يشمل الحسابات المرتبطة بالمصراوية وفودافون مرة واحدة؛ لا نضيف مصدرها فوقها.' },
      { key: 'purchases', label: 'المشتريات', currency: 'LYD', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'باقي أحدث يوم لكل دفتر، شامل المرحّل؛ لا نجمع أرصدة الأيام القديمة فوقه.' },
      { key: 'cash', label: 'النقد المسجّل بالخزينة', currency: 'LYD', balanceUnits: 0, count: 0, linkedCount: 0, explanation: 'من دفتر دخول وخروج الخزينة فقط؛ اعتماد التحصيل لا يضيف نقدًا هنا تلقائيًا.' },
    ];
    for (const source of sources) {
      const own = accounts.filter(row => sections[String(row.section_key)] === source.key);
      source.balanceUnits = sum(own, 'current_balance_units');
      source.count = own.length;
      source.linkedCount = own.filter(row => row.system_link_key !== null).length;
    }
    const purchaseDays = bigRows(db, `SELECT d.total_debt_units FROM purchase_days d WHERE d.organization_id=?
      AND d.day_number=(SELECT MAX(x.day_number) FROM purchase_days x WHERE x.organization_id=d.organization_id AND x.merchant_id=d.merchant_id)`, organizationId);
    sources[4].balanceUnits = sum(purchaseDays, 'total_debt_units');
    sources[4].count = purchaseDays.length;
    const cash = bigRows(db, 'SELECT balance_units FROM treasury_cash_accounts WHERE organization_id=?', organizationId);
    sources[5].balanceUnits = sum(cash, 'balance_units');
    sources[5].count = cash.length;
    const converted = egyptianConversion(db, organizationId, sources[3].balanceUnits);
    const receivablesUnits = safeUnits(BigInt(sources[0].balanceUnits) + BigInt(sources[1].balanceUnits), 'صافي الحسابات لنا');
    const liabilitiesUnits = safeUnits(BigInt(sources[2].balanceUnits) + BigInt(sources[4].balanceUnits), 'صافي الحسابات علينا');
    const position = {
      receivablesUnits, liabilitiesUnits, cashUnits: sources[5].balanceUnits,
      egyptianUnits: sources[3].balanceUnits, convertedUnits: converted.convertedUnits,
      rate: converted.rate, rateUpdatedAt: converted.rateUpdatedAt,
      netUnits: converted.convertedUnits === null ? null : safeUnits(BigInt(receivablesUnits) + BigInt(sources[5].balanceUnits)
        + BigInt(converted.convertedUnits) - BigInt(liabilitiesUnits), 'صافي المركز المالي'),
    };
    const movements = bigRows(db, `SELECT f.section_key,f.entry_kind,f.currency,f.amount_units,f.source_kind,
      t.amount_units source_amount,t.conversion_rate_micros source_rate FROM financial_ledger_entries f
      LEFT JOIN debt_transactions t ON f.source_kind='debt_transaction' AND t.id=f.source_id
      WHERE f.organization_id=? AND julianday(f.occurred_at)>=julianday(?) AND julianday(f.occurred_at)<julianday(?) AND ${liveLedger}`, organizationId, range.start, range.end).map(sourceMoney);
    const lyd = movements.filter(row => row.currency === 'LYD');
    const accountMoves = lyd.filter(row => row.section_key === 'customer_debts' || row.section_key === 'company_debts');
    const purchases = bigRows(db, `SELECT result_units,paid_units FROM purchase_entries WHERE organization_id=?
      AND julianday(created_at)>=julianday(?) AND julianday(created_at)<julianday(?) AND deleted_at IS NULL`, organizationId, range.start, range.end);
    const pending = bigRows(db, `SELECT s.status,s.amount_units,s.cash_received_at FROM collection_submissions s
      JOIN customers c ON c.id=s.customer_id WHERE c.organization_id=?
      UNION ALL SELECT status,amount_units,cash_received_at FROM collection_unlinked_receipts WHERE organization_id=?`, organizationId, organizationId);
    const pendingRows = pending.filter(row => row.status === 'pending');
    const outstandingRows = pending.filter(row => row.status === 'approved' && row.cash_received_at === null);
    const mismatch = db.prepare(`SELECT COUNT(*) n FROM collection_unlinked_receipts r
      JOIN debt_transactions t ON t.id=r.approved_transaction_id WHERE r.organization_id=? AND t.currency<>r.currency`).get(organizationId) as { n: number };
    const closingRows = db.prepare(`SELECT business_date,captured_at,snapshot_json FROM daily_financial_closings
      WHERE organization_id=? ORDER BY business_date DESC LIMIT 15`).all(organizationId) as Row[];
    const closings = closingRows.slice(0, 14).map((row, index) => {
      const current = JSON.parse(String(row.snapshot_json)) as PositionSnapshot;
      const previous = closingRows[index + 1] ? JSON.parse(String(closingRows[index + 1].snapshot_json)) as PositionSnapshot : null;
      const changeUnits = current.netUnits === null || previous?.netUnits === null || !previous ? null
        : safeUnits(BigInt(current.netUnits) - BigInt(previous.netUnits), 'فرق اللقطات');
      return { businessDate: String(row.business_date), capturedAt: String(row.captured_at), netUnits: current.netUnits,
        changeUnits, reasons: componentReasons(current, previous) };
    });
    const closingDate = currentBusinessDate(now, 'Africa/Tripoli');
    const yesterday = new Date(Date.parse(`${closingDate}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const latestClosing = readFiveAmClosing(db, organizationId, yesterday, now);
    return {
      generatedAt: now.toISOString(), businessDate: range.businessDate, timezone: range.timezone, position, sources,
      daily: {
        debtsUnits: sum(accountMoves.filter(row => row.entry_kind === 'debt'), 'amount_units'),
        paymentsUnits: sum(accountMoves.filter(row => row.entry_kind === 'payment'), 'amount_units'),
        purchasesUnits: sum(purchases, 'result_units'), purchasePaymentsUnits: sum(purchases, 'paid_units'),
        cashInUnits: sum(lyd.filter(row => row.section_key === 'treasury' && row.entry_kind === 'in'), 'amount_units'),
        cashOutUnits: sum(lyd.filter(row => row.section_key === 'treasury' && row.entry_kind === 'out'), 'amount_units'), movementCount: movements.length,
      },
      attention: { pendingCount: pendingRows.length, pendingUnits: sum(pendingRows, 'amount_units'),
        outstandingCount: outstandingRows.length, outstandingUnits: sum(outstandingRows, 'amount_units'), currencyMismatchCount: mismatch.n },
      closings, latestClosing: { state: latestClosing.state, businessDate: yesterday, scheduledAt: latestClosing.scheduledAt, netUnits: latestClosing.netUnits },
    };
  });
}

export function reportActivity(db: AppDatabase, organizationId: string, url: URL, now = new Date()) {
  return readSnapshot(db, () => {
    const group = url.searchParams.get('group') ?? 'all';
    if (group !== 'all' && !Object.hasOwn(activitySections, group)) throw badRequest('INVALID_REPORT_GROUP', 'مصدر التقرير غير صالح.');
    const page = Number(url.searchParams.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw badRequest('INVALID_REPORT_PAGE', 'صفحة التقرير غير صالحة.');
    const range = day(db, organizationId, now);
    const parameters: (string | number)[] = [organizationId, range.start, range.end];
    const section = group === 'all' ? '' : 'AND f.section_key=?';
    if (group !== 'all') parameters.push(activitySections[group as Exclude<ReportActivityGroup, 'all'>]);
    const rows = bigRows(db, `SELECT f.*,u.display_name actor_name,t.amount_units source_amount,t.conversion_rate_micros source_rate FROM financial_ledger_entries f
      LEFT JOIN users u ON u.id=f.actor_user_id AND u.organization_id=f.organization_id
      LEFT JOIN debt_transactions t ON f.source_kind='debt_transaction' AND t.id=f.source_id
      WHERE f.organization_id=? AND julianday(f.occurred_at)>=julianday(?) AND julianday(f.occurred_at)<julianday(?) AND ${liveLedger} ${section}
      ORDER BY f.occurred_at DESC,f.id DESC LIMIT 51 OFFSET ?`, ...parameters, (page - 1) * 50).map(sourceMoney);
    return { page, hasMore: rows.length > 50, businessDate: range.businessDate, items: rows.slice(0, 50).map(row => ({
      id: Number(row.id), sourceId: String(row.source_id), sourceKey: String(row.source_kind), sectionKey: String(row.section_key),
      entryKind: String(row.entry_kind), name: String(row.counterparty_name), description: String(row.description),
      actorName: String(row.actor_name ?? 'النظام'), occurredAt: String(row.occurred_at), currency: String(row.currency) as 'LYD' | 'EGP',
      amountUnits: safeUnits(BigInt(String(row.amount_units)), 'قيمة المعاملة'), effectUnits: safeUnits(BigInt(String(row.effect_units)), 'أثر المعاملة'),
    })) };
  });
}

export function reportSourceDetails(db: AppDatabase, organizationId: string, url: URL) {
  return readSnapshot(db, () => {
    const group = url.searchParams.get('group') ?? '';
    if (!Object.hasOwn(activitySections, group)) throw badRequest('INVALID_REPORT_GROUP', 'مصدر التقرير غير صالح.');
    const page = Number(url.searchParams.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw badRequest('INVALID_REPORT_PAGE', 'صفحة التقرير غير صالحة.');
    let rows: Row[];
    if (group === 'purchases') {
      rows = bigRows(db, `SELECT d.id,m.display_name name,d.total_debt_units balance,0 linked
        FROM purchase_days d JOIN purchase_merchants m ON m.id=d.merchant_id
        WHERE d.organization_id=? AND d.day_number=(SELECT MAX(x.day_number) FROM purchase_days x
          WHERE x.organization_id=d.organization_id AND x.merchant_id=d.merchant_id)
        ORDER BY m.display_name,d.id LIMIT 51 OFFSET ?`, organizationId, (page - 1) * 50);
    } else if (group === 'cash') {
      rows = bigRows(db, `SELECT organization_id id,'الخزينة' name,balance_units balance,0 linked
        FROM treasury_cash_accounts WHERE organization_id=? LIMIT 51 OFFSET ?`, organizationId, (page - 1) * 50);
    } else {
      rows = bigRows(db, `SELECT id,name,current_balance_units balance,system_link_key IS NOT NULL linked FROM customers
        WHERE organization_id=? AND section_key=? AND deleted_at IS NULL ORDER BY name,id LIMIT 51 OFFSET ?`,
      organizationId, activitySections[group as Exclude<ReportActivityGroup, 'all'>], (page - 1) * 50);
    }
    return { page, hasMore: rows.length > 50, items: rows.slice(0, 50).map(row => ({ id: String(row.id), name: String(row.name),
      balanceUnits: safeUnits(BigInt(String(row.balance)), 'رصيد المصدر'), linked: Number(row.linked) === 1 })) };
  });
}
