import type { Migration } from './migrationTypes.ts';

export const payrollCancellationMigrations: Migration[] = [{
  version: 61,
  name: 'collection-payroll-entry-cancellation',
  sql: `
    ALTER TABLE collection_payroll_entries ADD COLUMN cancelled_at TEXT;
    ALTER TABLE collection_payroll_entries ADD COLUMN cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
    CREATE TRIGGER trg_payroll_cancellation_scope BEFORE UPDATE OF cancelled_at,cancelled_by_user_id
    ON collection_payroll_entries
    WHEN (NEW.cancelled_at IS NULL) <> (NEW.cancelled_by_user_id IS NULL)
      OR (NEW.cancelled_by_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id=NEW.cancelled_by_user_id
          AND u.organization_id=NEW.organization_id AND u.role='admin'
      ))
    BEGIN SELECT RAISE(ABORT,'payroll_cancellation_scope_mismatch'); END;
  `,
}];
