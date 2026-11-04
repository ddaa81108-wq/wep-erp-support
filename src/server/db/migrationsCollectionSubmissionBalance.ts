import type { Migration } from './migrationTypes.ts';

export const collectionSubmissionBalanceMigrations: Migration[] = [
  {
    version: 55,
    name: 'freeze-collection-balance-at-first-submission',
    // NULL preserves the original historical amount for previously submitted cards.
    // Zero/negative balances are valid snapshots under the existing partial-payment rules.
    sql: 'ALTER TABLE debt_assignments ADD COLUMN first_submission_balance_units INTEGER;',
  },
];
