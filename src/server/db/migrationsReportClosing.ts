import type { Migration } from './migrationTypes.ts';

export const reportClosingMigrations: Migration[] = [
  {
    version: 49,
    name: 'fixed-five-am-financial-closing',
    sql: `
    CREATE TABLE daily_financial_closings (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      business_date TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      PRIMARY KEY (organization_id,business_date)
    ) STRICT;
  `,
  },
];
