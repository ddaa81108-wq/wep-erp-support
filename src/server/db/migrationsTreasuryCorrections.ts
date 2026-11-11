import type { Migration } from './migrationTypes.ts';

export const treasuryCorrectionMigrations: Migration[] = [
  {
    version: 58,
    name: 'treasury_cash_corrections',
    sql: `
    CREATE TABLE treasury_cash_corrections (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      entry_id TEXT NOT NULL REFERENCES treasury_cash_entries(id) ON DELETE RESTRICT,
      revision INTEGER NOT NULL CHECK(revision > 0),
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      amount_units INTEGER NOT NULL CHECK(amount_units > 0),
      description TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
      adjustment_entry_id TEXT REFERENCES treasury_cash_entries(id) ON DELETE RESTRICT,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(organization_id,entry_id,revision)
    ) STRICT;
    CREATE UNIQUE INDEX idx_cash_correction_adjustment ON treasury_cash_corrections(adjustment_entry_id)
      WHERE adjustment_entry_id IS NOT NULL;
    CREATE TRIGGER treasury_correction_scope BEFORE INSERT ON treasury_cash_corrections
    WHEN NOT EXISTS(SELECT 1 FROM treasury_cash_entries WHERE id=NEW.entry_id AND organization_id=NEW.organization_id)
      OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_user_id AND organization_id=NEW.organization_id)
      OR (NEW.adjustment_entry_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM treasury_cash_entries WHERE id=NEW.adjustment_entry_id AND organization_id=NEW.organization_id))
    BEGIN SELECT RAISE(ABORT,'treasury_correction_organization_mismatch'); END;
  `,
  },
];
