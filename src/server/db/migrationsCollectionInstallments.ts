import type { Migration } from './migrationTypes.ts';

export const collectionInstallmentMigrations: Migration[] = [{
  version: 51,
  name: 'allow-independent-pending-collection-installments',
  sql: `
    DROP INDEX uq_pending_collection_submission;
    CREATE INDEX idx_pending_collection_assignment
      ON collection_submissions(assignment_id,mode) WHERE status='pending';
    CREATE UNIQUE INDEX uq_pending_full_collection_submission
      ON collection_submissions(assignment_id) WHERE status='pending' AND mode='full';
  `,
}];
