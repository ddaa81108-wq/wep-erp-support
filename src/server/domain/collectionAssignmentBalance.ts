import type { AppDatabase } from '../db/database.ts';

/** Rejected receipts remain in history but cannot lock an otherwise unpaid card. */
export function releaseUnusedCollectionBalance(db: AppDatabase, assignmentId: string) {
  db.prepare(`UPDATE debt_assignments SET first_submission_balance_units=NULL
    WHERE id=? AND NOT EXISTS(SELECT 1 FROM collection_submissions
      WHERE assignment_id=? AND status IN ('pending','approved'))`).run(assignmentId, assignmentId);
}
