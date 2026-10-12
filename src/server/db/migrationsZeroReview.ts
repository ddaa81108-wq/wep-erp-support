import type { Migration } from './migrationTypes.ts';

export const zeroReviewMigrations: Migration[] = [{
  version: 45,
  name: 'customer_zero_balance_review',
  sql: `
    ALTER TABLE customers ADD COLUMN zero_review_pending INTEGER NOT NULL DEFAULT 0 CHECK(zero_review_pending IN (0,1));
    ALTER TABLE customers ADD COLUMN zero_review_financial_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN zero_reviewed_at TEXT;
    ALTER TABLE customers ADD COLUMN zero_reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE customers ADD COLUMN zero_reviewed_by_name TEXT;

    CREATE TRIGGER customer_zero_review_insert AFTER INSERT ON customers
    WHEN NEW.section_key='customer_debts' AND NEW.system_link_key IS NULL AND NEW.current_balance_units=0
    BEGIN
      UPDATE customers SET zero_review_pending=1 WHERE id=NEW.id;
    END;
    CREATE TRIGGER customer_zero_review_financial_change
    AFTER UPDATE OF current_balance_units, financial_updated_at ON customers
    WHEN NEW.section_key='customer_debts' AND NEW.system_link_key IS NULL
    BEGIN
      UPDATE customers SET
        zero_review_pending=CASE WHEN NEW.current_balance_units=0 THEN 1 ELSE 0 END,
        zero_review_financial_version=OLD.zero_review_financial_version+1,
        zero_reviewed_at=NULL,zero_reviewed_by=NULL,zero_reviewed_by_name=NULL
      WHERE id=NEW.id;
    END;
    CREATE INDEX idx_customers_review_feed ON customers(
      organization_id,section_key,
      (CASE WHEN current_balance_units=0 AND (section_key<>'customer_debts' OR zero_review_pending=0) THEN 1 ELSE 0 END),
      financial_updated_at DESC,id DESC
    ) WHERE deleted_at IS NULL;
    CREATE INDEX idx_customers_pending_review ON customers(organization_id,financial_updated_at DESC,id DESC)
      WHERE section_key='customer_debts' AND current_balance_units=0 AND zero_review_pending=1 AND deleted_at IS NULL;
  `,
}];
