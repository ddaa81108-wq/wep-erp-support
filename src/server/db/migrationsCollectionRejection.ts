import type { Migration } from './migrationTypes.ts';

export const collectionRejectionMigrations: Migration[] = [{
  version: 46,
  name: 'end-rejected-collection-assignments',
  sql: `
    UPDATE debt_assignments AS a
    SET status='cancelled', cancelled_at=(
      SELECT s.decided_at FROM collection_submissions s
      WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC,s.rowid DESC LIMIT 1
    )
    WHERE a.status='active' AND (
      SELECT s.status FROM collection_submissions s
      WHERE s.assignment_id=a.id ORDER BY s.submitted_at DESC,s.rowid DESC LIMIT 1
    )='rejected';
  `,
}];
