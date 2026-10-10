import type { Migration } from './migrationTypes.ts';

export const payrollMigrations: Migration[] = [
  {
    version: 41,
    name: 'collection-employee-payroll',
    sql: `
      CREATE TABLE collection_payroll_settings (
        employee_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        base_salary_units INTEGER NOT NULL DEFAULT 3500 CHECK(base_salary_units >= 0),
        updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_collection_payroll_settings_org
        ON collection_payroll_settings(organization_id, employee_user_id);

      CREATE TABLE collection_payroll_months (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        employee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        period_key TEXT NOT NULL CHECK(length(period_key) = 7),
        base_salary_units INTEGER NOT NULL CHECK(base_salary_units >= 0),
        opening_carry_units INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(organization_id, employee_user_id, period_key)
      ) STRICT;
      CREATE INDEX idx_collection_payroll_month_employee
        ON collection_payroll_months(organization_id, employee_user_id, period_key DESC);

      CREATE TABLE collection_payroll_entries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        month_id TEXT NOT NULL REFERENCES collection_payroll_months(id) ON DELETE RESTRICT,
        employee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        entry_kind TEXT NOT NULL CHECK(entry_kind IN ('withdrawal','commission')),
        amount_units INTEGER NOT NULL CHECK(amount_units > 0),
        reason TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        confirmed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        confirmed_at TEXT,
        UNIQUE(organization_id, request_id)
      ) STRICT;
      CREATE INDEX idx_collection_payroll_entries_month
        ON collection_payroll_entries(month_id, created_at DESC, id DESC);
      CREATE INDEX idx_collection_payroll_entries_employee_pending
        ON collection_payroll_entries(employee_user_id, confirmed_at, created_at DESC);

      CREATE TRIGGER trg_collection_payroll_settings_scope_insert
      BEFORE INSERT ON collection_payroll_settings
      WHEN NOT EXISTS (
        SELECT 1 FROM users employee, users editor
        WHERE employee.id=NEW.employee_user_id
          AND employee.organization_id=NEW.organization_id
          AND employee.role='employee'
          AND editor.id=NEW.updated_by_user_id
          AND editor.organization_id=NEW.organization_id
          AND editor.role='admin'
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_payroll_scope_mismatch');
      END;

      CREATE TRIGGER trg_collection_payroll_settings_scope_update
      BEFORE UPDATE OF employee_user_id,organization_id,updated_by_user_id
      ON collection_payroll_settings
      WHEN NOT EXISTS (
        SELECT 1 FROM users employee, users editor
        WHERE employee.id=NEW.employee_user_id
          AND employee.organization_id=NEW.organization_id
          AND employee.role='employee'
          AND editor.id=NEW.updated_by_user_id
          AND editor.organization_id=NEW.organization_id
          AND editor.role='admin'
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_payroll_scope_mismatch');
      END;

      CREATE TRIGGER trg_collection_payroll_month_scope_insert
      BEFORE INSERT ON collection_payroll_months
      WHEN NOT EXISTS (
        SELECT 1 FROM users employee
        WHERE employee.id=NEW.employee_user_id
          AND employee.organization_id=NEW.organization_id
          AND employee.role='employee'
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_payroll_scope_mismatch');
      END;

      CREATE TRIGGER trg_collection_payroll_entry_scope_insert
      BEFORE INSERT ON collection_payroll_entries
      WHEN NOT EXISTS (
        SELECT 1 FROM collection_payroll_months month, users creator
        WHERE month.id=NEW.month_id
          AND month.organization_id=NEW.organization_id
          AND month.employee_user_id=NEW.employee_user_id
          AND creator.id=NEW.created_by_user_id
          AND creator.organization_id=NEW.organization_id
          AND creator.role='admin'
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_payroll_scope_mismatch');
      END;

      CREATE TRIGGER trg_collection_payroll_confirmation_scope
      BEFORE UPDATE OF confirmed_by_user_id,confirmed_at ON collection_payroll_entries
      WHEN NEW.confirmed_by_user_id IS NOT NULL AND (
        NEW.confirmed_at IS NULL OR NEW.confirmed_by_user_id<>NEW.employee_user_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_payroll_confirmation_mismatch');
      END;
    `,
  },
];
