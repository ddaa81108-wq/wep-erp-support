import type { AppDatabase } from '../../db/database.ts';
import { currentBusinessDate, finalizePastReports, refreshDailyReport } from './reports.ts';

function refreshOrganizations(database: AppDatabase) {
  const organizations = database.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[];
  const today = currentBusinessDate();
  for (const organization of organizations) {
    finalizePastReports(database, String(organization.id), today);
    refreshDailyReport(database, String(organization.id), today);
  }
}

export function startReportScheduler(database: AppDatabase, intervalMs = 60_000) {
  try {
    refreshOrganizations(database);
  } catch (error) {
    console.error('[reports-initial-refresh]', error);
  }
  const timer = setInterval(() => {
    try {
      refreshOrganizations(database);
    } catch (error) {
      console.error('[reports-scheduled-refresh]', error);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
