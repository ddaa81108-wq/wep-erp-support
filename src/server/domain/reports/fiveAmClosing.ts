import type { AppDatabase } from '../../db/database.ts';
import { treasuryDashboard } from '../treasuryQueries.ts';
import { businessDayRange, currentBusinessDate } from './businessDates.ts';
import type { PositionSnapshot } from './reportModel.ts';

const TIMEZONE = 'Africa/Tripoli';
const CAPTURE_WINDOW_MS = 60_000;

function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function fiveAmDeadline(reportDay: string) {
  return new Date(Date.parse(businessDayRange(shiftDay(reportDay, 1), TIMEZONE).start) + 5 * 3_600_000);
}

/** Called only inside the scheduler's outer write transaction. Never backfill a missed deadline. */
export function captureFiveAmClosing(
  database: AppDatabase,
  organizationId: string,
  startedAt: number,
  now = new Date(),
) {
  const day = shiftDay(currentBusinessDate(now, TIMEZONE), -1);
  const deadline = fiveAmDeadline(day);
  const due = deadline.getTime();
  if (startedAt >= due || now.getTime() < due || now.getTime() >= due + CAPTURE_WINDOW_MS) return false;
  if (
    database
      .prepare('SELECT 1 FROM daily_financial_closings WHERE organization_id=? AND business_date=?')
      .get(organizationId, day)
  )
    return false;
  const treasury = treasuryDashboard(database, organizationId);
  const snapshot: PositionSnapshot = {
    receivablesUnits: treasury.receivablesUnits,
    liabilitiesUnits: treasury.liabilitiesUnits,
    activeCashUnits: treasury.activeCashUnits,
    egyptianSourceUnits: treasury.egyptianSourceUnits,
    egyptianConvertedUnits: treasury.egyptianConvertedUnits,
    egyptianRate: treasury.egyptianRate,
    netUnits: treasury.netUnits,
  };
  const result = database
    .prepare(
      `INSERT INTO daily_financial_closings
    (organization_id,business_date,scheduled_at,captured_at,snapshot_json)
    VALUES(?,?,?,?,?) ON CONFLICT(organization_id,business_date) DO NOTHING`,
    )
    .run(organizationId, day, deadline.toISOString(), now.toISOString(), JSON.stringify(snapshot));
  if (!result.changes) return false;
  database
    .prepare(
      `INSERT INTO event_log(topic,organization_id,aggregate_id,payload_json,created_at)
    VALUES('treasury.report.closed',?,NULL,'{}',?)`,
    )
    .run(organizationId, now.toISOString());
  return true;
}

export function readFiveAmClosing(
  database: AppDatabase,
  organizationId: string,
  businessDate: string,
  now = new Date(),
) {
  const row = database
    .prepare(
      `SELECT scheduled_at,captured_at,snapshot_json FROM daily_financial_closings
    WHERE organization_id=? AND business_date=?`,
    )
    .get(organizationId, businessDate) as
    { scheduled_at: string; captured_at: string; snapshot_json: string } | undefined;
  const scheduledAt = fiveAmDeadline(businessDate).toISOString();
  if (!row)
    return {
      state:
        now.getTime() < Date.parse(scheduledAt) + CAPTURE_WINDOW_MS
          ? ('pending' as const)
          : ('missed' as const),
      scheduledAt,
      capturedAt: null,
      netUnits: null,
    };
  const snapshot = JSON.parse(row.snapshot_json) as PositionSnapshot;
  return {
    state: snapshot.netUnits === null ? ('missing_rate' as const) : ('recorded' as const),
    scheduledAt: row.scheduled_at,
    capturedAt: row.captured_at,
    netUnits: snapshot.netUnits,
  };
}
