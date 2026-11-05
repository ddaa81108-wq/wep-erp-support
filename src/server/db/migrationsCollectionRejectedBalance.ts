import type { Migration } from './migrationTypes.ts';

export const collectionRejectedBalanceMigrations: Migration[] = [{
  version: 56,
  name: 'release-rejected-collection-balance-reference',
  sql: `
    UPDATE debt_assignments AS a SET first_submission_balance_units=NULL
    WHERE a.status='active' AND NOT EXISTS(SELECT 1 FROM collection_submissions s
      WHERE s.assignment_id=a.id AND s.status IN ('pending','approved'));

    -- Schema 55 could retain an earlier rejected receipt's snapshot when a fresh
    -- receipt was submitted after all previous receipts had already been rejected.
    -- Repair only from the exact balance captured in that fresh submit's audit.
    -- Unknown legacy values and overlapping partial receipts are left unchanged.
    WITH first_live AS (
      SELECT a.id AS assignment_id,s.id AS submission_id,s.submitted_at,s.rowid AS submission_rowid
      FROM debt_assignments a JOIN collection_submissions s ON s.assignment_id=a.id
      WHERE a.status='active' AND s.status IN ('pending','approved')
        AND s.rowid=(SELECT rowid FROM collection_submissions first
          WHERE first.assignment_id=a.id AND first.status IN ('pending','approved')
          ORDER BY first.submitted_at,first.rowid LIMIT 1)
    ), evidence AS (
      SELECT entity_id,CASE WHEN json_valid(details_json) THEN
        CASE WHEN json_type(details_json,'$.balanceAtSubmissionUnits')='integer'
        THEN json_extract(details_json,'$.balanceAtSubmissionUnits') END END AS balance
      FROM audit_log WHERE action='collection.submit' AND entity_type='collection_submission'
    ), repair AS (
      SELECT f.assignment_id,e.balance FROM first_live f JOIN evidence e ON e.entity_id=f.submission_id
      WHERE e.balance BETWEEN -9007199254740991 AND 9007199254740991
        AND EXISTS(SELECT 1 FROM collection_submissions r WHERE r.assignment_id=f.assignment_id
          AND (r.submitted_at,r.rowid)<(f.submitted_at,f.submission_rowid))
        AND NOT EXISTS(SELECT 1 FROM collection_submissions r WHERE r.assignment_id=f.assignment_id
          AND (r.submitted_at,r.rowid)<(f.submitted_at,f.submission_rowid)
          AND (r.status<>'rejected' OR r.approved_transaction_id IS NOT NULL
            OR r.decided_at IS NULL OR r.decided_at>f.submitted_at))
    )
    UPDATE debt_assignments SET first_submission_balance_units=(
      SELECT balance FROM repair WHERE assignment_id=debt_assignments.id LIMIT 1)
    WHERE id IN (SELECT assignment_id FROM repair);
  `,
}];
