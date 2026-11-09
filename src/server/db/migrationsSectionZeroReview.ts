import type { Migration } from './migrationTypes.ts';

// Replaces the customer-only triggers from schema 45. No balance, ledger, or
// historical pending-flag rewrite: zeros that already exist stay as they were.
export const sectionZeroReviewMigrations: Migration[] = [
  {
    version: 57,
    name: 'section_zero_balance_review',
    sql: `
    DROP TRIGGER IF EXISTS customer_zero_review_insert;
    DROP TRIGGER IF EXISTS customer_zero_review_financial_change;
    DROP INDEX IF EXISTS idx_customers_review_feed;
    DROP INDEX IF EXISTS idx_customers_pending_review;

    CREATE TRIGGER customer_zero_review_insert AFTER INSERT ON customers
    WHEN NEW.section_key IN ('customer_debts','company_debts','libyan_deposits','egyptian_deposits')
      AND NEW.system_link_key IS NULL AND NEW.current_balance_units=0
    BEGIN
      UPDATE customers SET zero_review_pending=1 WHERE id=NEW.id;
    END;

    CREATE TRIGGER customer_zero_review_financial_change
    AFTER UPDATE OF current_balance_units, financial_updated_at ON customers
    WHEN NEW.section_key IN ('customer_debts','company_debts','libyan_deposits','egyptian_deposits')
      AND NEW.system_link_key IS NULL
    BEGIN
      UPDATE customers SET
        zero_review_pending=CASE WHEN NEW.current_balance_units=0 THEN 1 ELSE 0 END,
        zero_review_financial_version=OLD.zero_review_financial_version+1,
        zero_reviewed_at=NULL,zero_reviewed_by=NULL,zero_reviewed_by_name=NULL
      WHERE id=NEW.id;
    END;

    CREATE INDEX idx_customers_review_feed ON customers(
      organization_id,section_key,
      (CASE WHEN current_balance_units=0 AND (zero_review_pending=0 OR system_link_key IS NOT NULL) THEN 1 ELSE 0 END),
      financial_updated_at DESC,id DESC
    ) WHERE deleted_at IS NULL;

    CREATE INDEX idx_customers_pending_review ON customers(organization_id,section_key,financial_updated_at DESC,id DESC)
      WHERE section_key IN ('customer_debts','company_debts','libyan_deposits','egyptian_deposits')
        AND current_balance_units=0 AND zero_review_pending=1 AND deleted_at IS NULL
        AND system_link_key IS NULL;
  `,
  },
];
