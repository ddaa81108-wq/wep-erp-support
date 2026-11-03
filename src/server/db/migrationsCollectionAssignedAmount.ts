import type { Migration } from './migrationTypes.ts';

export const collectionAssignedAmountMigrations: Migration[] = [
  {
    version: 54,
    name: 'preserve-collection-assigned-balance',
    sql: `
    ALTER TABLE debt_assignments ADD COLUMN assigned_balance_units INTEGER
      CHECK(assigned_balance_units IS NULL OR assigned_balance_units > 0);
    -- Recover an old value only when the account has had no unrelated ledger edits
    -- or cycle changes since assignment. Unknown history stays NULL, never zero.
    UPDATE debt_assignments AS a SET assigned_balance_units=(
      SELECT c.current_balance_units + COALESCE((
        SELECT SUM(t.amount_units) FROM collection_submissions s
        JOIN debt_transactions t ON t.id=s.approved_transaction_id
        WHERE s.assignment_id=a.id AND s.status='approved'
          AND t.transaction_status='posted' AND t.deleted_at IS NULL
          AND t.entry_type='payment'
      ),0) FROM customers c WHERE c.id=a.customer_id
    )
    WHERE NOT EXISTS(SELECT 1 FROM customer_cycles cy WHERE cy.customer_id=a.customer_id AND cy.created_at>a.assigned_at)
      AND NOT EXISTS(
        SELECT 1 FROM debt_transactions t WHERE t.customer_id=a.customer_id
          AND (t.created_at>=a.assigned_at OR t.updated_at>=a.assigned_at)
          AND NOT EXISTS(SELECT 1 FROM collection_submissions s
            WHERE s.assignment_id=a.id AND s.approved_transaction_id=t.id)
      )
      AND (SELECT c.current_balance_units + COALESCE((
        SELECT SUM(t.amount_units) FROM collection_submissions s
        JOIN debt_transactions t ON t.id=s.approved_transaction_id
        WHERE s.assignment_id=a.id AND s.status='approved'
          AND t.transaction_status='posted' AND t.deleted_at IS NULL AND t.entry_type='payment'
      ),0) FROM customers c WHERE c.id=a.customer_id)>0;
  `,
  },
];
