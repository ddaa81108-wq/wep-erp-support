import type { Migration } from './migrationTypes.ts';

export const masraweyaCorrectionMigrations: Migration[] = [
  {
    version: 42,
    name: 'masraweya-admin-correction-workflow',
    sql: `
      ALTER TABLE masraweya_days ADD COLUMN correction_open INTEGER NOT NULL DEFAULT 0 CHECK(correction_open IN (0,1));
      ALTER TABLE masraweya_days ADD COLUMN correction_opened_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
      ALTER TABLE masraweya_days ADD COLUMN correction_opened_at TEXT;
      CREATE INDEX idx_masraweya_days_correction ON masraweya_days(organization_id,status,correction_open,business_date DESC);
    `,
  },
];
