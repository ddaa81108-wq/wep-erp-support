import type { Migration } from './migrationTypes.ts';

export const organizationMigrations: Migration[] = [
  {
    version: 14,
    name: 'masraweya-daily-work-sheets',
    sql: `
      CREATE TABLE masraweya_days (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL UNIQUE,
        previous_value_units INTEGER NOT NULL DEFAULT 0,
        purchases_units INTEGER NOT NULL DEFAULT 0,
        exchange_rate_micros INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        finalized_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        CHECK (exchange_rate_micros IS NULL OR exchange_rate_micros > 0)
      ) STRICT;
      CREATE TABLE masraweya_entries (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL REFERENCES masraweya_days(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        value_units INTEGER NOT NULL CHECK (value_units >= 0),
        commission_units INTEGER NOT NULL CHECK (commission_units >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (day_id, sequence)
      ) STRICT;
      CREATE INDEX idx_masraweya_days_status_date ON masraweya_days(status, business_date DESC);
      CREATE INDEX idx_masraweya_entries_day_sequence ON masraweya_entries(day_id, sequence);
    `,
  },
  {
    version: 15,
    name: 'organization-scoped-collection-batches',
    sql: `
      ALTER TABLE collection_batches
        ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
      UPDATE collection_batches SET organization_id = 'org-default' WHERE organization_id IS NULL;
      CREATE INDEX idx_collection_batches_organization_status
        ON collection_batches(organization_id, status, opened_at DESC);
    `,
  },
  {
    version: 16,
    name: 'organization-scoped-realtime-events',
    sql: `
      ALTER TABLE event_log
        ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
      UPDATE event_log
      SET organization_id = COALESCE(
        (SELECT organization_id FROM users WHERE users.id = event_log.actor_user_id),
        'org-default'
      )
      WHERE organization_id IS NULL;
      CREATE INDEX idx_event_organization_sequence
        ON event_log(organization_id, sequence);
    `,
  },
  {
    version: 17,
    name: 'organization-scoped-masraweya-and-exchange-rates',
    sql: `
      ALTER TABLE masraweya_entries RENAME TO masraweya_entries_v16;
      ALTER TABLE masraweya_days RENAME TO masraweya_days_v16;

      CREATE TABLE masraweya_days (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        business_date TEXT NOT NULL,
        previous_value_units INTEGER NOT NULL DEFAULT 0,
        purchases_units INTEGER NOT NULL DEFAULT 0,
        exchange_rate_micros INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        finalized_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT,
        UNIQUE (organization_id, business_date),
        CHECK (exchange_rate_micros IS NULL OR exchange_rate_micros > 0)
      ) STRICT;
      CREATE TABLE masraweya_entries (
        id TEXT PRIMARY KEY,
        day_id TEXT NOT NULL REFERENCES masraweya_days(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        value_units INTEGER NOT NULL CHECK (value_units >= 0),
        commission_units INTEGER NOT NULL CHECK (commission_units >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (day_id, sequence)
      ) STRICT;
      INSERT INTO masraweya_days(
        id,organization_id,business_date,previous_value_units,purchases_units,
        exchange_rate_micros,status,version,created_by_user_id,updated_by_user_id,
        finalized_by_user_id,created_at,updated_at,finalized_at
      )
      SELECT id,'org-default',business_date,previous_value_units,purchases_units,
        exchange_rate_micros,status,version,created_by_user_id,updated_by_user_id,
        finalized_by_user_id,created_at,updated_at,finalized_at
      FROM masraweya_days_v16;
      INSERT INTO masraweya_entries
      SELECT * FROM masraweya_entries_v16;
      DROP TABLE masraweya_entries_v16;
      DROP TABLE masraweya_days_v16;
      CREATE INDEX idx_masraweya_days_organization_status_date
        ON masraweya_days(organization_id, status, business_date DESC);
      CREATE INDEX idx_masraweya_entries_day_sequence
        ON masraweya_entries(day_id, sequence);

      ALTER TABLE section_exchange_rates RENAME TO section_exchange_rates_v16;
      CREATE TABLE section_exchange_rates (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        section_key TEXT NOT NULL,
        source_currency TEXT NOT NULL,
        target_currency TEXT NOT NULL,
        source_units_per_target_micros INTEGER NOT NULL CHECK (source_units_per_target_micros > 0),
        updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, section_key),
        CHECK (source_currency <> target_currency)
      ) STRICT;
      INSERT INTO section_exchange_rates(
        organization_id,section_key,source_currency,target_currency,
        source_units_per_target_micros,updated_by_user_id,updated_at
      )
      SELECT 'org-default',section_key,source_currency,target_currency,
        source_units_per_target_micros,updated_by_user_id,updated_at
      FROM section_exchange_rates_v16;
      DROP TABLE section_exchange_rates_v16;
    `,
  },
  {
    version: 18,
    name: 'organization-scoped-account-requests',
    sql: `
      ALTER TABLE account_requests
        ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
      UPDATE account_requests SET organization_id = 'org-default' WHERE organization_id IS NULL;
      CREATE INDEX idx_account_requests_organization_status_time
        ON account_requests(organization_id, status, requested_at DESC);
    `,
  },
  {
    version: 19,
    name: 'database-enforced-organization-boundaries',
    sql: `
      CREATE TRIGGER trg_users_branch_organization_insert
      BEFORE INSERT ON users
      WHEN NEW.organization_id IS NULL OR NEW.home_branch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM branches b
        WHERE b.id = NEW.home_branch_id AND b.organization_id = NEW.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'organization_branch_mismatch');
      END;
      CREATE TRIGGER trg_users_branch_organization_update
      BEFORE UPDATE OF organization_id, home_branch_id ON users
      WHEN NEW.organization_id IS NULL OR NEW.home_branch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM branches b
        WHERE b.id = NEW.home_branch_id AND b.organization_id = NEW.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'organization_branch_mismatch');
      END;

      CREATE TRIGGER trg_debt_transaction_organization_insert
      BEFORE INSERT ON debt_transactions
      WHEN NOT EXISTS (
        SELECT 1 FROM customers c
        JOIN branches b ON b.id = NEW.branch_id
        JOIN users u ON u.id = NEW.actor_user_id
        WHERE c.id = NEW.customer_id
          AND c.organization_id = b.organization_id
          AND u.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'debt_transaction_organization_mismatch');
      END;
      CREATE TRIGGER trg_debt_transaction_organization_update
      BEFORE UPDATE OF customer_id, branch_id, actor_user_id ON debt_transactions
      WHEN NOT EXISTS (
        SELECT 1 FROM customers c
        JOIN branches b ON b.id = NEW.branch_id
        JOIN users u ON u.id = NEW.actor_user_id
        WHERE c.id = NEW.customer_id
          AND c.organization_id = b.organization_id
          AND u.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'debt_transaction_organization_mismatch');
      END;

      CREATE TRIGGER trg_treasury_transaction_organization_insert
      BEFORE INSERT ON treasury_transactions
      WHEN NOT EXISTS (
        SELECT 1 FROM branches b JOIN users u ON u.id = NEW.actor_user_id
        WHERE b.id = NEW.branch_id AND b.organization_id = u.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'treasury_transaction_organization_mismatch');
      END;
      CREATE TRIGGER trg_treasury_transaction_organization_update
      BEFORE UPDATE OF branch_id, actor_user_id ON treasury_transactions
      WHEN NOT EXISTS (
        SELECT 1 FROM branches b JOIN users u ON u.id = NEW.actor_user_id
        WHERE b.id = NEW.branch_id AND b.organization_id = u.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'treasury_transaction_organization_mismatch');
      END;

      CREATE TRIGGER trg_debt_assignment_organization_insert
      BEFORE INSERT ON debt_assignments
      WHEN NOT EXISTS (
        SELECT 1 FROM customers c
        JOIN users assignee ON assignee.id = NEW.assignee_user_id
        JOIN users assigner ON assigner.id = NEW.assigned_by_user_id
        WHERE c.id = NEW.customer_id
          AND assignee.organization_id = c.organization_id
          AND assigner.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'debt_assignment_organization_mismatch');
      END;
      CREATE TRIGGER trg_debt_assignment_organization_update
      BEFORE UPDATE OF customer_id, assignee_user_id, assigned_by_user_id ON debt_assignments
      WHEN NOT EXISTS (
        SELECT 1 FROM customers c
        JOIN users assignee ON assignee.id = NEW.assignee_user_id
        JOIN users assigner ON assigner.id = NEW.assigned_by_user_id
        WHERE c.id = NEW.customer_id
          AND assignee.organization_id = c.organization_id
          AND assigner.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'debt_assignment_organization_mismatch');
      END;

      CREATE TRIGGER trg_collection_submission_organization_insert
      BEFORE INSERT ON collection_submissions
      WHEN NOT EXISTS (
        SELECT 1 FROM debt_assignments a
        JOIN customers c ON c.id = NEW.customer_id
        JOIN users u ON u.id = NEW.collector_user_id
        WHERE a.id = NEW.assignment_id AND a.customer_id = NEW.customer_id
          AND u.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_submission_organization_mismatch');
      END;
      CREATE TRIGGER trg_collection_submission_organization_update
      BEFORE UPDATE OF assignment_id, customer_id, collector_user_id ON collection_submissions
      WHEN NOT EXISTS (
        SELECT 1 FROM debt_assignments a
        JOIN customers c ON c.id = NEW.customer_id
        JOIN users u ON u.id = NEW.collector_user_id
        WHERE a.id = NEW.assignment_id AND a.customer_id = NEW.customer_id
          AND u.organization_id = c.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_submission_organization_mismatch');
      END;
    `,
  },
  {
    version: 20,
    name: 'organization-scoped-audit-log',
    sql: `
      ALTER TABLE audit_log
        ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
      UPDATE audit_log
      SET organization_id = COALESCE(
        (SELECT organization_id FROM users WHERE users.id = audit_log.actor_user_id),
        'org-default'
      )
      WHERE organization_id IS NULL;
      CREATE INDEX idx_audit_organization_time
        ON audit_log(organization_id, created_at DESC, id DESC);
      CREATE INDEX idx_audit_organization_entity
        ON audit_log(organization_id, entity_type, entity_id, created_at DESC);
      CREATE TRIGGER trg_audit_log_organization_insert
      BEFORE INSERT ON audit_log
      WHEN NEW.organization_id IS NULL OR NEW.actor_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.actor_user_id AND u.organization_id = NEW.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'audit_log_organization_mismatch');
      END;
      CREATE TRIGGER trg_audit_log_organization_update
      BEFORE UPDATE OF actor_user_id, organization_id ON audit_log
      WHEN NEW.organization_id IS NULL OR NEW.actor_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.actor_user_id AND u.organization_id = NEW.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'audit_log_organization_mismatch');
      END;
    `,
  },
  {
    version: 21,
    name: 'organization-section-card-feed-order',
    sql: `
      CREATE INDEX idx_customers_organization_section_feed_order
        ON customers(
          organization_id,
          section_key,
          (current_balance_units = 0),
          is_pinned DESC,
          financial_updated_at DESC,
          id DESC
        )
        WHERE deleted_at IS NULL;
    `,
  },
  {
    version: 22,
    name: 'rate-limit-google-oauth-state-by-address',
    sql: `
      ALTER TABLE oauth_states
        ADD COLUMN remote_address TEXT NOT NULL DEFAULT 'unknown';
      CREATE INDEX idx_oauth_states_address_created
        ON oauth_states(remote_address, created_at)
        WHERE consumed_at IS NULL;
    `,
  },
  {
    version: 23,
    name: 'organization-local-collection-batch-numbers',
    sql: `
      ALTER TABLE collection_batches
        ADD COLUMN organization_batch_number INTEGER NOT NULL DEFAULT 1
        CHECK (organization_batch_number > 0);
      UPDATE collection_batches AS current
      SET organization_batch_number = (
        SELECT COUNT(*)
        FROM collection_batches AS prior
        WHERE prior.organization_id = current.organization_id
          AND prior.business_date = current.business_date
          AND (
            prior.opened_at < current.opened_at
            OR (prior.opened_at = current.opened_at AND prior.id <= current.id)
          )
      );
      CREATE UNIQUE INDEX uq_collection_batches_organization_local_number
        ON collection_batches(organization_id, business_date, organization_batch_number);
    `,
  },
  {
    version: 24,
    name: 'bind-google-oauth-to-browser-and-pkce',
    sql: `
      ALTER TABLE oauth_states ADD COLUMN browser_binding_hash TEXT;
      ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT;
      ALTER TABLE oauth_states ADD COLUMN nonce_hash TEXT;
      DELETE FROM oauth_states;
    `,
  },
];
