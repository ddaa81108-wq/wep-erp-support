import type { AppDatabase } from '../../db/database.ts';
import { beforeTransactionCommit, inImmediateTransaction } from '../../db/database.ts';
import { organizationBusinessDate } from './businessDates.ts';
import { finalizePastReports, refreshDailyReport } from './reports.ts';

function refreshOrganizations(database: AppDatabase) {
  const organizations = database.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[];
  for (const organization of organizations) {
    const today = organizationBusinessDate(database, String(organization.id));
    finalizePastReports(database, String(organization.id), today);
    refreshDailyReport(database, String(organization.id), today);
  }
}

export function startReportScheduler(database: AppDatabase, intervalMs = 60_000) {
  // Every business transaction persists its final treasury snapshot atomically.
  // Nested transactions do not notify observers until the outer commit.
  const unsubscribe = beforeTransactionCommit(database, () => refreshOrganizations(database));
  try {
    inImmediateTransaction(database, () => undefined);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const timer = setInterval(() => {
    try {
      inImmediateTransaction(database, () => undefined);
    } catch (error) {
      console.error('[reports-scheduled-refresh]', error);
    }
  }, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); unsubscribe(); };
}
