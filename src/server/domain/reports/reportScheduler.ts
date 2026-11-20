import type { AppDatabase } from '../../db/database.ts';
import { afterTransactionCommit, beforeTransactionCommit, inImmediateTransaction } from '../../db/database.ts';
import { currentBusinessDate, organizationBusinessDate } from './businessDates.ts';
import { finalizePastReports, refreshDailyReport } from './reports.ts';
import { captureFiveAmClosing, fiveAmDeadline, type CommittedClosingPosition } from './fiveAmClosing.ts';
import { treasuryDashboard } from '../treasuryQueries.ts';

function deadlineToday(now: Date) {
  const today = currentBusinessDate(now, 'Africa/Tripoli');
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  return fiveAmDeadline(yesterday).getTime();
}

export function startReportScheduler(database: AppDatabase, intervalMs = 60_000) {
  const startedAt = Date.now();
  const committed = new Map<string, CommittedClosingPosition>();
  const frozen = new Map<string, { deadline: number; position: CommittedClosingPosition }>();
  let pending = new Map<string, CommittedClosingPosition['snapshot']>();
  const unsubscribe = beforeTransactionCommit(database, () => {
    pending = new Map();
    const now = new Date(), due = deadlineToday(now);
    const organizations = database.prepare("SELECT id FROM organizations WHERE status='active'").all() as { id: string }[];
    for (const { id } of organizations) {
      const held = frozen.get(id);
      const previous = held?.deadline === due ? held.position : committed.get(id);
      // Close using the successful state before 05:00, not changes made by
      // the first post-deadline transaction whose body has already run.
      if (previous && previous.committedAt < due) {
        captureFiveAmClosing(database, id, startedAt, now, previous);
      }
      const today = organizationBusinessDate(database, id);
      finalizePastReports(database, id, today);
      const report = refreshDailyReport(database, id, today);
      const position = report.isFinalized ? treasuryDashboard(database, id) : report;
      const auditCursor = Number(database.prepare('SELECT COALESCE(MAX(id),0) id FROM audit_log WHERE organization_id=?').get(id)!.id);
      pending.set(id, {
        auditCursor, receivablesUnits: position.receivablesUnits,
        liabilitiesUnits: position.liabilitiesUnits, activeCashUnits: position.activeCashUnits,
        egyptianSourceUnits: position.egyptianSourceUnits, egyptianConvertedUnits: position.egyptianConvertedUnits,
        egyptianRate: position.egyptianRate, netUnits: position.netUnits,
      });
    }
  });
  const unsubscribeCommitted = afterTransactionCommit(database, () => {
    const now = Date.now(), due = deadlineToday(new Date(now));
    for (const [id, snapshot] of pending) {
      const previous = committed.get(id);
      // A SQLite COMMIT itself can straddle the deadline. Keep its prior
      // state until the next scheduler turn, before advancing this cache.
      if (previous && previous.committedAt < due && now >= due && frozen.get(id)?.deadline !== due) {
        frozen.set(id, { deadline: due, position: previous });
      }
      committed.set(id, { snapshot, committedAt: now });
    }
  });
  try {
    inImmediateTransaction(database, () => undefined);
  } catch (error) {
    unsubscribe();
    unsubscribeCommitted();
    throw error;
  }
  const refresh = () => {
    try {
      inImmediateTransaction(database, () => undefined);
    } catch (error) {
      console.error('[reports-scheduled-refresh]', error);
    }
  };
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
  let deadlineTimer: ReturnType<typeof setTimeout>;
  const armDeadline = () => {
    const now = Date.now();
    let next = deadlineToday(new Date(now));
    if (next <= now) next += 86400000;
    deadlineTimer = setTimeout(() => { refresh(); armDeadline(); }, Math.max(1, next - now));
    deadlineTimer.unref();
  };
  armDeadline();
  return () => {
    clearInterval(timer); clearTimeout(deadlineTimer);
    unsubscribe(); unsubscribeCommitted();
  };
}
