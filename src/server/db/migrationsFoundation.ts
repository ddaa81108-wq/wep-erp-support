import type { Migration } from './migrationTypes.ts';
import {
  ensurePermanentCustomerLedgerColumns,
  rebuildCustomerFinancialSummaries,
} from './migrationHooks.ts';

export const foundationMigrations: Migration[] = [
  {
    version: 1,
    name: 'local-foundation',
    sql: `
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE user_permissions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, permission)
      ) STRICT;

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_hash TEXT NOT NULL,
        client_api_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      CREATE INDEX idx_sessions_user_active ON sessions(user_id, expires_at)
        WHERE revoked_at IS NULL;

      CREATE TABLE login_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        remote_address TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_login_failures_lookup
        ON login_failures(username, remote_address, occurred_at);

      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        phone TEXT,
        account_type TEXT NOT NULL DEFAULT 'customer'
          CHECK (account_type IN ('customer', 'employee', 'partner')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX uq_customers_active_name
        ON customers(normalized_name) WHERE deleted_at IS NULL;
      CREATE INDEX idx_customers_created ON customers(created_at DESC, id DESC)
        WHERE deleted_at IS NULL;

      CREATE TABLE customer_cycles (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        initial_balance_units INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'LYD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((status = 'active' AND end_date IS NULL)
          OR (status = 'closed' AND end_date IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX uq_customer_active_cycle
        ON customer_cycles(customer_id) WHERE status = 'active';

      CREATE TABLE debt_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        cycle_id TEXT NOT NULL REFERENCES customer_cycles(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('debt', 'payment')),
        amount_units INTEGER NOT NULL CHECK (amount_units > 0),
        currency TEXT NOT NULL,
        conversion_rate_micros INTEGER NOT NULL DEFAULT 1000000
          CHECK (conversion_rate_micros > 0),
        calculation_mode TEXT NOT NULL DEFAULT 'direct'
          CHECK (calculation_mode IN ('direct', 'multiply', 'divide')),
        input_value_micros INTEGER NOT NULL CHECK (input_value_micros > 0),
        calculation_factor_micros INTEGER,
        payment_mode TEXT CHECK (payment_mode IN ('partial', 'full') OR payment_mode IS NULL),
        transaction_date TEXT NOT NULL,
        reference_no TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL DEFAULT '',
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        actor_name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK ((entry_type = 'payment' AND payment_mode IS NOT NULL)
          OR (entry_type = 'debt' AND payment_mode IS NULL)),
        CHECK ((calculation_mode = 'direct' AND calculation_factor_micros IS NULL)
          OR (calculation_mode <> 'direct' AND calculation_factor_micros > 0))
      ) STRICT;
      CREATE INDEX idx_debt_tx_customer_date
        ON debt_transactions(customer_id, transaction_date DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_debt_tx_cycle
        ON debt_transactions(cycle_id) WHERE deleted_at IS NULL;

      CREATE TABLE treasury_transactions (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        amount_units INTEGER NOT NULL CHECK (amount_units > 0),
        currency TEXT NOT NULL,
        conversion_rate_micros INTEGER NOT NULL DEFAULT 1000000
          CHECK (conversion_rate_micros > 0),
        transaction_date TEXT NOT NULL,
        reference_no TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN (
          'customer_payment', 'company_payment', 'purchase',
          'manual_deposit', 'manual_withdraw', 'deposit_escrow'
        )),
        source_id TEXT,
        description TEXT NOT NULL,
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX uq_treasury_source
        ON treasury_transactions(source, source_id)
        WHERE source_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_treasury_date
        ON treasury_transactions(transaction_date DESC, id DESC)
        WHERE deleted_at IS NULL;

      CREATE TABLE reference_sequences (
        name TEXT PRIMARY KEY,
        next_value INTEGER NOT NULL CHECK (next_value > 0)
      ) STRICT;
      INSERT INTO reference_sequences(name, next_value)
        VALUES ('customer_transaction', 1);

      CREATE TABLE idempotency_keys (
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        scope TEXT NOT NULL,
        request_id TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (actor_user_id, scope, request_id)
      ) STRICT;
      CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        correlation_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_audit_actor_time ON audit_log(actor_user_id, created_at DESC);
      CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);

      CREATE TABLE event_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        aggregate_id TEXT,
        actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_event_topic_sequence ON event_log(topic, sequence);
    `,
  },
  {
    version: 2,
    name: 'organizations-and-branches',
    legacyNames: ['organizations-branches-and-collections'],
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'Africa/Tripoli',
        base_currency TEXT NOT NULL DEFAULT 'LYD',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (organization_id, code)
      ) STRICT;

      INSERT INTO organizations(id, name, slug, created_at, updated_at)
      VALUES ('org-default', 'المؤسسة الرئيسية', 'default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO branches(id, organization_id, code, name, created_at, updated_at)
      VALUES ('branch-main', 'org-default', 'MAIN', 'الفرع الرئيسي', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      ALTER TABLE users ADD COLUMN organization_id TEXT REFERENCES organizations(id);
      ALTER TABLE users ADD COLUMN home_branch_id TEXT REFERENCES branches(id);
      ALTER TABLE customers ADD COLUMN organization_id TEXT REFERENCES organizations(id);
      ALTER TABLE debt_transactions ADD COLUMN branch_id TEXT REFERENCES branches(id);

      UPDATE users SET organization_id = 'org-default', home_branch_id = 'branch-main';
      UPDATE customers SET organization_id = 'org-default';
      UPDATE debt_transactions SET branch_id = 'branch-main';

      CREATE INDEX idx_users_organization ON users(organization_id, is_active);
      CREATE INDEX idx_customers_organization ON customers(organization_id, updated_at DESC);
      CREATE INDEX idx_debt_tx_branch ON debt_transactions(branch_id, transaction_date DESC);

      DROP INDEX uq_treasury_source;
      DROP INDEX idx_treasury_date;
      ALTER TABLE treasury_transactions RENAME TO treasury_transactions_v1;
      CREATE TABLE treasury_transactions (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        amount_units INTEGER NOT NULL CHECK (amount_units > 0),
        currency TEXT NOT NULL,
        conversion_rate_micros INTEGER NOT NULL DEFAULT 1000000 CHECK (conversion_rate_micros > 0),
        transaction_date TEXT NOT NULL,
        reference_no TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN (
          'customer_payment', 'company_payment', 'purchase',
          'manual_deposit', 'manual_withdraw', 'deposit_escrow'
        )),
        source_id TEXT,
        description TEXT NOT NULL,
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;
      INSERT INTO treasury_transactions(
        id, direction, amount_units, currency, conversion_rate_micros,
        transaction_date, reference_no, source, source_id, description,
        actor_user_id, branch_id, created_at, updated_at, deleted_at
      ) SELECT id, direction, amount_units, currency, conversion_rate_micros,
        transaction_date, reference_no, source, source_id, description,
        actor_user_id, 'branch-main', created_at, updated_at, deleted_at
      FROM treasury_transactions_v1;
      DROP TABLE treasury_transactions_v1;
      CREATE UNIQUE INDEX uq_treasury_source ON treasury_transactions(source, source_id)
        WHERE source_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_treasury_date ON treasury_transactions(transaction_date DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_treasury_branch ON treasury_transactions(branch_id, transaction_date DESC);

    `,
  },
  {
    version: 3,
    name: 'reserved-legacy-collections-cleanup-marker',
    legacyNames: ['remove-collections-and-collector-workspace'],
    sql: `SELECT 1;`,
  },
  {
    version: 4,
    name: 'permanent-customer-ledger',
    before: ensurePermanentCustomerLedgerColumns,
    sql: `
      UPDATE debt_transactions AS current
      SET customer_sequence = (
        SELECT COUNT(*)
        FROM debt_transactions AS earlier
        WHERE earlier.customer_id = current.customer_id
          AND (
            earlier.created_at < current.created_at
            OR (earlier.created_at = current.created_at AND earlier.id <= current.id)
          )
      );

      UPDATE customers
      SET ledger_next_sequence = COALESCE((
        SELECT MAX(customer_sequence) + 1
        FROM debt_transactions
        WHERE debt_transactions.customer_id = customers.id
      ), 1);

      UPDATE customers
      SET inactive_since = updated_at
      WHERE id IN (
        SELECT c.id
        FROM customers c
        JOIN customer_cycles cy ON cy.customer_id = c.id AND cy.status = 'active'
        LEFT JOIN debt_transactions t
          ON t.cycle_id = cy.id
          AND t.deleted_at IS NULL
          AND t.transaction_status = 'posted'
        GROUP BY c.id, cy.id
        HAVING cy.initial_balance_units + COALESCE(SUM(
          CASE t.entry_type WHEN 'debt' THEN t.amount_units ELSE -t.amount_units END
        ), 0) = 0
      );

      CREATE UNIQUE INDEX uq_customer_ledger_sequence
        ON debt_transactions(customer_id, customer_sequence)
        WHERE customer_sequence IS NOT NULL;
      CREATE INDEX idx_customer_smart_visibility
        ON customers(is_pinned, inactive_since, updated_at DESC);
      CREATE INDEX idx_debt_tx_corrections
        ON debt_transactions(corrects_transaction_id)
        WHERE corrects_transaction_id IS NOT NULL;
    `,
  },
  {
    version: 5,
    name: 'employee-identities-and-section-access',
    sql: `
      ALTER TABLE users ADD COLUMN email TEXT;
      ALTER TABLE users ADD COLUMN password_login_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (password_login_enabled IN (0, 1));
      ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
        CHECK (must_change_password IN (0, 1));

      CREATE UNIQUE INDEX uq_users_email
        ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

      CREATE TABLE user_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('google')),
        provider_subject TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE,
        email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (provider, provider_subject),
        UNIQUE (provider, email)
      ) STRICT;
      CREATE INDEX idx_user_identities_user ON user_identities(user_id);

      CREATE TABLE account_requests (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('google')),
        provider_subject TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE,
        display_name TEXT NOT NULL,
        picture_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected')),
        decision_note TEXT NOT NULL DEFAULT '',
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        approved_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        UNIQUE (provider, provider_subject),
        UNIQUE (provider, email)
      ) STRICT;
      CREATE INDEX idx_account_requests_status_time
        ON account_requests(status, requested_at DESC);

      CREATE TABLE user_section_access (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        section_key TEXT NOT NULL,
        access_level TEXT NOT NULL CHECK (access_level IN ('read', 'manage')),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, section_key)
      ) STRICT;
      CREATE INDEX idx_user_section_access_section
        ON user_section_access(section_key, access_level);

      INSERT INTO user_section_access(user_id, section_key, access_level, updated_at)
      SELECT user_id, 'customer_debts',
        CASE WHEN MAX(CASE WHEN permission = 'debts.write' AND allowed = 1 THEN 1 ELSE 0 END) = 1
          THEN 'manage' ELSE 'read' END,
        MAX(updated_at)
      FROM user_permissions
      WHERE allowed = 1 AND permission IN ('debts.read', 'debts.write')
      GROUP BY user_id;
    `,
  },
  {
    version: 6,
    name: 'google-oauth-state',
    sql: `
      CREATE TABLE oauth_states (
        state_hash TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('login', 'register')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;
      CREATE INDEX idx_oauth_states_expiry ON oauth_states(expires_at);
    `,
  },
  {
    version: 7,
    name: 'company-debts-section',
    sql: `
      INSERT OR IGNORE INTO reference_sequences(name, next_value)
      VALUES ('company_transaction', 1);
      CREATE INDEX IF NOT EXISTS idx_customers_account_type
        ON customers(account_type, is_pinned, updated_at DESC)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    version: 8,
    name: 'deposit-sections-and-future-treasury-conversion',
    sql: `
      ALTER TABLE customers ADD COLUMN section_key TEXT NOT NULL DEFAULT 'customer_debts';
      UPDATE customers SET section_key = CASE account_type
        WHEN 'partner' THEN 'company_debts'
        ELSE 'customer_debts'
      END;
      DROP INDEX uq_customers_active_name;
      CREATE UNIQUE INDEX uq_customers_section_name
        ON customers(section_key, normalized_name) WHERE deleted_at IS NULL;
      CREATE INDEX idx_customers_section
        ON customers(section_key, is_pinned, updated_at DESC) WHERE deleted_at IS NULL;

      INSERT OR IGNORE INTO reference_sequences(name, next_value) VALUES
        ('libyan_deposit_transaction', 1),
        ('egyptian_deposit_transaction', 1);

      CREATE TABLE section_exchange_rates (
        section_key TEXT PRIMARY KEY,
        source_currency TEXT NOT NULL,
        target_currency TEXT NOT NULL,
        source_units_per_target_micros INTEGER NOT NULL CHECK (source_units_per_target_micros > 0),
        updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL,
        CHECK (source_currency <> target_currency)
      ) STRICT;
    `,
  },
  {
    version: 9,
    name: 'debt-collection-assignments-and-approval',
    sql: `
      CREATE TABLE debt_assignments (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        assignee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assigned_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
        assigned_at TEXT NOT NULL,
        completed_at TEXT,
        cancelled_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX uq_active_debt_assignment
        ON debt_assignments(customer_id) WHERE status = 'active';
      CREATE INDEX idx_debt_assignments_assignee
        ON debt_assignments(assignee_user_id, status, assigned_at DESC);

      CREATE TABLE collection_submissions (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES debt_assignments(id) ON DELETE RESTRICT,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        collector_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        mode TEXT NOT NULL CHECK (mode IN ('full', 'partial')),
        amount_units INTEGER NOT NULL CHECK (amount_units > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        submitted_at TEXT NOT NULL,
        decided_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        decided_at TEXT,
        decision_note TEXT NOT NULL DEFAULT '',
        approved_transaction_id TEXT REFERENCES debt_transactions(id) ON DELETE RESTRICT,
        cash_received_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        cash_received_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX uq_pending_collection_submission
        ON collection_submissions(assignment_id) WHERE status = 'pending';
      CREATE INDEX idx_collection_submissions_review
        ON collection_submissions(status, submitted_at DESC);
      CREATE INDEX idx_collection_submissions_collector
        ON collection_submissions(collector_user_id, submitted_at DESC);
    `,
  },
  {
    version: 10,
    name: 'permanent-collection-cards',
    sql: `
      UPDATE debt_assignments AS closed
      SET status = 'active', completed_at = NULL
      WHERE status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM debt_assignments AS active
          WHERE active.customer_id = closed.customer_id AND active.status = 'active'
        );
    `,
  },
  {
    version: 11,
    name: 'collection-business-days',
    sql: `
      ALTER TABLE debt_assignments ADD COLUMN business_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE collection_submissions ADD COLUMN business_date TEXT NOT NULL DEFAULT '';
      UPDATE debt_assignments SET business_date = date('now') WHERE business_date = '';
      UPDATE collection_submissions SET business_date = date('now') WHERE business_date = '';
      CREATE INDEX idx_debt_assignments_business_date ON debt_assignments(business_date, assigned_at DESC);
      CREATE INDEX idx_collection_submissions_business_date ON collection_submissions(business_date, submitted_at DESC);
      CREATE TABLE collection_day_closures (
        business_date TEXT PRIMARY KEY,
        closed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        closed_at TEXT NOT NULL,
        deleted_assignments INTEGER NOT NULL,
        deleted_submissions INTEGER NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 12,
    name: 'repeatable-collection-work-batches',
    sql: `
      CREATE TABLE collection_batches (
        id TEXT PRIMARY KEY,
        business_date TEXT NOT NULL,
        batch_number INTEGER NOT NULL CHECK (batch_number > 0),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        deleted_assignments INTEGER NOT NULL DEFAULT 0,
        deleted_submissions INTEGER NOT NULL DEFAULT 0,
        UNIQUE (business_date, batch_number)
      ) STRICT;
      ALTER TABLE debt_assignments ADD COLUMN batch_id TEXT REFERENCES collection_batches(id) ON DELETE RESTRICT;
      ALTER TABLE collection_submissions ADD COLUMN batch_id TEXT REFERENCES collection_batches(id) ON DELETE RESTRICT;
      INSERT INTO collection_batches(id,business_date,batch_number,status,opened_at)
      SELECT lower(hex(randomblob(16))), COALESCE(MIN(business_date),date('now')), 1, 'open', COALESCE(MIN(assigned_at),datetime('now'))
      FROM debt_assignments HAVING COUNT(*) > 0;
      UPDATE debt_assignments SET batch_id=(SELECT id FROM collection_batches WHERE status='open' LIMIT 1) WHERE batch_id IS NULL;
      UPDATE collection_submissions SET batch_id=(SELECT batch_id FROM debt_assignments WHERE debt_assignments.id=collection_submissions.assignment_id) WHERE batch_id IS NULL;
      CREATE INDEX idx_debt_assignments_batch ON debt_assignments(batch_id,assigned_at DESC);
      CREATE INDEX idx_collection_submissions_batch ON collection_submissions(batch_id,submitted_at DESC);
    `,
  },
  {
    version: 13,
    name: 'customer-feed-pagination-and-financial-summary',
    after: rebuildCustomerFinancialSummaries,
    sql: `
      ALTER TABLE customers ADD COLUMN current_balance_units INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN debt_started_at TEXT;
      ALTER TABLE customers ADD COLUMN financial_updated_at TEXT;

      UPDATE customers
      SET current_balance_units = COALESCE((
        SELECT cy.initial_balance_units + COALESCE(SUM(
          CASE t.entry_type
            WHEN 'debt' THEN (t.amount_units * t.conversion_rate_micros) / 1000000
            WHEN 'payment' THEN -((t.amount_units * t.conversion_rate_micros) / 1000000)
          END
        ), 0)
        FROM customer_cycles cy
        LEFT JOIN debt_transactions t ON t.cycle_id = cy.id
          AND t.deleted_at IS NULL AND t.transaction_status = 'posted'
        WHERE cy.customer_id = customers.id AND cy.status = 'active'
        GROUP BY cy.id
      ), 0),
      financial_updated_at = COALESCE((
        SELECT MAX(t.updated_at)
        FROM debt_transactions t
        WHERE t.customer_id = customers.id
          AND t.deleted_at IS NULL AND t.transaction_status = 'posted'
      ), customers.updated_at);

      UPDATE customers
      SET debt_started_at = CASE WHEN current_balance_units > 0 THEN (
        SELECT MIN(t.transaction_date)
        FROM debt_transactions t
        WHERE t.customer_id = customers.id AND t.entry_type = 'debt'
          AND t.deleted_at IS NULL AND t.transaction_status = 'posted'
      ) ELSE NULL END;

      CREATE INDEX idx_customers_section_feed
        ON customers(section_key, current_balance_units, is_pinned, financial_updated_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_customers_section_search
        ON customers(section_key, normalized_name, phone)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_debt_tx_customer_posted_sequence
        ON debt_transactions(customer_id, customer_sequence, created_at)
        WHERE deleted_at IS NULL AND transaction_status = 'posted';
    `,
  },
];
