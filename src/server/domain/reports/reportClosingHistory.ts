import type { AppDatabase } from '../../db/database.ts';
import type { ReportClosingHistory, ReportClosingJournal } from '../../../shared/reportOverview.ts';
import { badRequest, notFound } from '../../http/errors.ts';
import { safeUnits } from '../treasurySupport.ts';
import { componentReasons, type PositionSnapshot } from './reportModel.ts';
import { fiveAmDeadline } from './fiveAmClosing.ts';
import { readReportSnapshot } from './reportReadSupport.ts';

type ClosingSnapshot = PositionSnapshot & { auditCursor?: number };
type Row = { business_date: string; captured_at: string; snapshot_json: string };
function validDay(value: string) {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
    throw badRequest('INVALID_REPORT_DAY', 'تاريخ اللقطة غير صالح.');
  return value;
}
const cursor = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readClosingPage(db: AppDatabase, organizationId: string, before?: string | null): ReportClosingHistory {
  return readReportSnapshot(db, () => {
    if (before) validDay(before);
    const rows = db.prepare(`SELECT business_date,captured_at,snapshot_json FROM daily_financial_closings
      WHERE organization_id=? AND (? IS NULL OR business_date<?) ORDER BY business_date DESC LIMIT 21`)
      .all(organizationId, before ?? null, before ?? null) as Row[];
    const items = rows.slice(0, 20).map((row, index) => {
      const current = JSON.parse(row.snapshot_json) as ClosingSnapshot;
      const previousRow = rows[index + 1];
      const previous = previousRow ? JSON.parse(previousRow.snapshot_json) as ClosingSnapshot : null;
      const changeUnits = current.netUnits === null || !previous || previous.netUnits === null ? null
        : safeUnits(BigInt(current.netUnits) - BigInt(previous.netUnits), 'فرق اللقطات');
      const cashUnits = integer(current.activeCashUnits);
      const cashChangeUnits = cashUnits === null || !previous || integer(previous.activeCashUnits) === null ? null
        : safeUnits(BigInt(cashUnits) - BigInt(previous.activeCashUnits), 'فرق النقد');
      return { businessDate: row.business_date, capturedAt: row.captured_at, netUnits: current.netUnits, changeUnits,
        cashUnits, cashChangeUnits, previousBusinessDate: previousRow?.business_date ?? null,
        reasons: componentReasons(current, previous) };
    });
    return { items, hasMore: rows.length > 20, nextBefore: rows.length > 20 ? items.at(-1)!.businessDate : null };
  });
}

/** Execution-time journal, never a reconstruction from today's mutable transaction rows. */
export function closingJournal(db: AppDatabase, organizationId: string, url: URL): ReportClosingJournal {
  return readReportSnapshot(db, () => {
    const day = validDay(url.searchParams.get('day') ?? '');
    const page = Number(url.searchParams.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw badRequest('INVALID_REPORT_PAGE', 'صفحة التقرير غير صالحة.');
    const selected = db.prepare(`SELECT business_date,captured_at,snapshot_json FROM daily_financial_closings WHERE organization_id=? AND business_date=?`)
      .get(organizationId, day) as Row | undefined;
    if (!selected) throw notFound('report_closing');
    const previous = db.prepare(`SELECT business_date,captured_at,snapshot_json FROM daily_financial_closings
      WHERE organization_id=? AND business_date<? ORDER BY business_date DESC LIMIT 1`).get(organizationId, day) as Row | undefined;
    const currentSnapshot = JSON.parse(selected.snapshot_json) as ClosingSnapshot;
    const previousSnapshot = previous ? JSON.parse(previous.snapshot_json) as ClosingSnapshot : null;
    const from = previous?.captured_at ?? fiveAmDeadline(new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)).toISOString();
    const to = selected.captured_at;
    const exactBounds = cursor(currentSnapshot.auditCursor) && Boolean(previousSnapshot && cursor(previousSnapshot.auditCursor));
    const parameters: (string | number)[] = [organizationId];
    let bounds: string;
    if (exactBounds) {
      bounds = 'a.id>? AND a.id<=?';
      parameters.push(previousSnapshot!.auditCursor!, currentSnapshot.auditCursor!);
    } else {
      bounds = 'julianday(a.created_at)>julianday(?) AND julianday(a.created_at)<=julianday(?)';
      parameters.push(from, to);
      if (cursor(currentSnapshot.auditCursor)) { bounds += ' AND a.id<=?'; parameters.push(currentSnapshot.auditCursor); }
    }
    const rows = db.prepare(`SELECT a.id,a.action,a.entity_id,a.details_json,a.created_at,u.display_name actor_name
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id AND u.organization_id=a.organization_id
      WHERE a.organization_id=? AND a.outcome='success' AND ${bounds}
      AND (a.action GLOB 'customer.*' OR a.action GLOB 'company.*' OR a.action GLOB 'libyan_deposit.*'
        OR a.action GLOB 'egyptian_deposit.*' OR a.action GLOB 'deposit.*' OR a.action GLOB 'purchases.*'
        OR a.action GLOB 'masraweya.*' OR a.action GLOB 'treasury.*' OR a.action GLOB 'collection.*')
      ORDER BY a.id DESC LIMIT 51 OFFSET ?`).all(...parameters, (page - 1) * 50) as Record<string, unknown>[];
    const items = rows.slice(0, 50).map(row => {
      const details = record(JSON.parse(String(row.details_json)));
      const before = record(details.previous);
      const next = record(details.next);
      const action = String(row.action);
      const currency = action.startsWith('egyptian_deposit.') || action.startsWith('masraweya.') ? 'EGP' as const
        : action.startsWith('deposit.') ? null : 'LYD' as const;
      return { id: Number(row.id), action, name: String(details.subjectName ?? details.customerName ?? details.merchant ?? ''),
        actorName: String(row.actor_name ?? 'النظام'), createdAt: String(row.created_at), currency,
        amountUnits: integer(details.amountUnits), paidUnits: integer(details.paidUnits), previousUnits: integer(before.amountUnits),
        nextUnits: integer(next.amountUnits), reference: String(details.sequence ?? row.entity_id ?? ''),
        description: String(details.reason ?? details.businessDate ?? '').slice(0, 1000) };
    });
    return { items, page, hasMore: rows.length > 50, businessDate: day, from, to,
      previousBusinessDate: previous?.business_date ?? null, boundary: exactBounds ? 'sequence' : 'time' };
  });
}
