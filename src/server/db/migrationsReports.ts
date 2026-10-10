import type { Migration } from './migrationTypes.ts';

export const reportMigrations: Migration[] = [
  {
    version: 31,
    name: 'daily-read-only-financial-reports',
    sql: `
      CREATE TABLE daily_financial_reports (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        business_date TEXT NOT NULL,
        receivables_units INTEGER NOT NULL,
        liabilities_units INTEGER NOT NULL,
        active_cash_units INTEGER NOT NULL,
        egyptian_source_units INTEGER NOT NULL,
        egyptian_converted_units INTEGER,
        egyptian_rate REAL,
        net_units INTEGER,
        daily_receivables_added_units INTEGER NOT NULL DEFAULT 0,
        daily_payments_units INTEGER NOT NULL DEFAULT 0,
        daily_liabilities_effect_units INTEGER NOT NULL DEFAULT 0,
        daily_cash_in_units INTEGER NOT NULL DEFAULT 0,
        daily_cash_out_units INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('normal','review','critical','missing_rate')),
        summary TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        generated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, business_date)
      ) STRICT;
      CREATE INDEX idx_daily_financial_reports_feed
        ON daily_financial_reports(organization_id, business_date DESC);
    `,
  },
  {
    version: 32,
    name: 'finalize-daily-financial-reports',
    sql: `
      ALTER TABLE daily_financial_reports
        ADD COLUMN is_finalized INTEGER NOT NULL DEFAULT 0 CHECK (is_finalized IN (0,1));
      ALTER TABLE daily_financial_reports ADD COLUMN finalized_at TEXT;
      CREATE INDEX idx_daily_financial_reports_open
        ON daily_financial_reports(organization_id, is_finalized, business_date);
    `,
  },
];
