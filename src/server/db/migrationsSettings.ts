import type { Migration } from './migrationTypes.ts';

export const settingsMigrations: Migration[] = [
  {
    version: 33,
    name: 'protected-owner-and-administration-settings',
    sql: `
      ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0
        CHECK (is_owner IN (0, 1));

      UPDATE users
      SET is_owner = 1
      WHERE id IN (
        SELECT owner.id
        FROM users AS owner
        WHERE owner.role = 'admin'
          AND owner.id = (
            SELECT candidate.id
            FROM users AS candidate
            WHERE candidate.organization_id = owner.organization_id
              AND candidate.role = 'admin'
            ORDER BY candidate.created_at ASC, candidate.id ASC
            LIMIT 1
          )
      );

      CREATE UNIQUE INDEX uq_users_one_owner_per_organization
        ON users(organization_id) WHERE is_owner = 1;
      CREATE INDEX idx_users_admin_directory
        ON users(organization_id, role, is_active, display_name);

      CREATE TABLE organization_settings (
        organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
        system_name TEXT NOT NULL DEFAULT 'عبده ERP',
        timezone TEXT NOT NULL DEFAULT 'Africa/Tripoli',
        locale TEXT NOT NULL DEFAULT 'ar-LY',
        employee_sections_visible INTEGER NOT NULL DEFAULT 1
          CHECK (employee_sections_visible IN (0, 1)),
        updated_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO organization_settings(
        organization_id, system_name, timezone, locale,
        employee_sections_visible, updated_at
      )
      SELECT id, name, 'Africa/Tripoli', 'ar-LY', 1, CURRENT_TIMESTAMP
      FROM organizations;
    `,
  },
  {
    version: 34,
    name: 'operations-center-session-devices-and-technical-events',
    sql: `
      ALTER TABLE sessions ADD COLUMN remote_address TEXT NOT NULL DEFAULT '';
      ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

      CREATE TABLE technical_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        request_method TEXT NOT NULL DEFAULT '',
        request_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_technical_events_org_time
        ON technical_events(organization_id, created_at DESC);
    `,
  },
  {
    version: 35,
    name: 'targeted-realtime-notifications-and-preferences',
    sql: `
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        section_key TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        read_at TEXT
      ) STRICT;
      CREATE INDEX idx_notifications_recipient_time
        ON notifications(recipient_user_id, read_at, id DESC);
      CREATE INDEX idx_notifications_organization_time
        ON notifications(organization_id, id DESC);

      CREATE TABLE notification_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN (0,1)),
        speech_enabled INTEGER NOT NULL DEFAULT 0 CHECK(speech_enabled IN (0,1)),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TRIGGER trg_audit_notifications_for_administration
      AFTER INSERT ON audit_log
      WHEN NEW.outcome='success'
        AND NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.actor_user_id AND actor.is_owner=1)
      BEGIN
        INSERT INTO notifications(
          organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,
          section_key,details_json,created_at
        )
        SELECT NEW.organization_id,recipient.id,NEW.actor_user_id,NEW.action,NEW.entity_type,
          NEW.entity_id,
          CASE
            WHEN NEW.action LIKE 'customer.%' THEN 'customers'
            WHEN NEW.action LIKE 'company.%' THEN 'companies'
            WHEN NEW.action LIKE 'libyan_deposit.%' THEN 'libyan-deposits'
            WHEN NEW.action LIKE 'egyptian_deposit.%' THEN 'egyptian-deposits'
            WHEN NEW.action LIKE 'collection.%' THEN 'collections'
            WHEN NEW.action LIKE 'masraweya.%' THEN 'masraweya'
            WHEN NEW.action LIKE 'purchases.%' THEN 'purchases'
            WHEN NEW.action LIKE 'treasury.%' THEN 'treasury'
            WHEN NEW.action LIKE 'user.%' OR NEW.action LIKE 'account_request.%' OR NEW.action LIKE 'settings.%' THEN 'settings'
            ELSE NULL
          END,
          NEW.details_json,NEW.created_at
        FROM users recipient
        WHERE recipient.organization_id=NEW.organization_id
          AND recipient.role='admin' AND recipient.is_active=1
          AND recipient.id<>NEW.actor_user_id;
      END;

      CREATE TRIGGER trg_collection_assignment_notification_for_employee
      AFTER INSERT ON audit_log
      WHEN NEW.outcome='success' AND NEW.action='collection.assign'
      BEGIN
        INSERT INTO notifications(
          organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,
          section_key,details_json,created_at
        )
        SELECT NEW.organization_id,u.id,NEW.actor_user_id,NEW.action,NEW.entity_type,NEW.entity_id,
          'collections',NEW.details_json,NEW.created_at
        FROM users u
        WHERE u.id=json_extract(NEW.details_json,'$.assigneeId')
          AND u.organization_id=NEW.organization_id AND u.is_active=1;
      END;
    `,
  },
  {
    version: 36,
    name: 'notification-action-snapshots-and-duplicate-suppression',
    sql: `
      DROP TRIGGER trg_audit_notifications_for_administration;

      CREATE TRIGGER trg_audit_notifications_for_administration
      AFTER INSERT ON audit_log
      WHEN NEW.outcome='success'
        AND COALESCE(json_extract(NEW.details_json,'$.suppressNotification'),0)=0
        AND NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=NEW.actor_user_id AND actor.is_owner=1)
      BEGIN
        INSERT INTO notifications(
          organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,
          section_key,details_json,created_at
        )
        SELECT NEW.organization_id,recipient.id,NEW.actor_user_id,NEW.action,NEW.entity_type,
          NEW.entity_id,
          CASE
            WHEN NEW.action LIKE 'customer.%' THEN 'customers'
            WHEN NEW.action LIKE 'company.%' THEN 'companies'
            WHEN NEW.action LIKE 'libyan_deposit.%' THEN 'libyan-deposits'
            WHEN NEW.action LIKE 'egyptian_deposit.%' THEN 'egyptian-deposits'
            WHEN NEW.action LIKE 'collection.%' THEN 'collections'
            WHEN NEW.action LIKE 'masraweya.%' THEN 'masraweya'
            WHEN NEW.action LIKE 'purchases.%' THEN 'purchases'
            WHEN NEW.action LIKE 'treasury.%' THEN 'treasury'
            WHEN NEW.action LIKE 'user.%' OR NEW.action LIKE 'account_request.%' OR NEW.action LIKE 'settings.%' THEN 'settings'
            ELSE NULL
          END,
          NEW.details_json,NEW.created_at
        FROM users recipient
        WHERE recipient.organization_id=NEW.organization_id
          AND recipient.role='admin' AND recipient.is_active=1
          AND recipient.id<>NEW.actor_user_id;
      END;
    `,
  },
  {
    version: 37,
    name: 'customer-feed-financial-recency-order',
    sql: `
      CREATE INDEX idx_customers_financial_recency
        ON customers(
          organization_id,
          section_key,
          (current_balance_units = 0),
          financial_updated_at DESC,
          id DESC
        )
        WHERE deleted_at IS NULL;
    `,
  },
  {
    version: 38,
    name: 'customer-name-similarity-search',
    sql: `
      CREATE VIRTUAL TABLE customer_name_search USING fts5(
        customer_id UNINDEXED,
        organization_id UNINDEXED,
        section_key UNINDEXED,
        normalized_name,
        tokenize='unicode61'
      );

      INSERT INTO customer_name_search(customer_id,organization_id,section_key,normalized_name)
      SELECT id,organization_id,section_key,normalized_name FROM customers WHERE deleted_at IS NULL;

      CREATE TRIGGER trg_customer_name_search_insert AFTER INSERT ON customers
      WHEN NEW.deleted_at IS NULL
      BEGIN
        INSERT INTO customer_name_search(customer_id,organization_id,section_key,normalized_name)
        VALUES(NEW.id,NEW.organization_id,NEW.section_key,NEW.normalized_name);
      END;

      CREATE TRIGGER trg_customer_name_search_update AFTER UPDATE OF normalized_name,organization_id,section_key,deleted_at ON customers
      BEGIN
        DELETE FROM customer_name_search WHERE customer_id=OLD.id;
        INSERT INTO customer_name_search(customer_id,organization_id,section_key,normalized_name)
        SELECT NEW.id,NEW.organization_id,NEW.section_key,NEW.normalized_name WHERE NEW.deleted_at IS NULL;
      END;

      CREATE TRIGGER trg_customer_name_search_delete AFTER DELETE ON customers
      BEGIN
        DELETE FROM customer_name_search WHERE customer_id=OLD.id;
      END;
    `,
  },
  {
    version: 39,
    name: 'remove-masraweya-direct-treasury-conversion',
    sql: `
      UPDATE masraweya_days SET exchange_rate_micros=NULL WHERE exchange_rate_micros IS NOT NULL;
    `,
  },
  {
    version: 40,
    name: 'unlinked-employee-collection-receipts',
    sql: `
      CREATE TABLE collection_unlinked_receipts (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        collector_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        customer_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        amount_units INTEGER NOT NULL CHECK(amount_units > 0),
        request_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected')),
        submitted_at TEXT NOT NULL,
        business_date TEXT NOT NULL,
        batch_id TEXT NOT NULL REFERENCES collection_batches(id) ON DELETE RESTRICT,
        linked_customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
        entry_type TEXT CHECK(entry_type IN ('debt','payment')),
        decided_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        decided_at TEXT,
        decision_note TEXT NOT NULL DEFAULT '',
        approved_transaction_id TEXT REFERENCES debt_transactions(id) ON DELETE RESTRICT,
        cash_received_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        cash_received_at TEXT,
        UNIQUE(collector_user_id, request_id)
      ) STRICT;
      CREATE INDEX idx_collection_unlinked_review
        ON collection_unlinked_receipts(organization_id,status,submitted_at DESC);
      CREATE INDEX idx_collection_unlinked_collector
        ON collection_unlinked_receipts(collector_user_id,submitted_at DESC);
      CREATE INDEX idx_collection_unlinked_batch
        ON collection_unlinked_receipts(batch_id,submitted_at DESC);

      CREATE TRIGGER trg_collection_unlinked_organization_insert
      BEFORE INSERT ON collection_unlinked_receipts
      WHEN NOT EXISTS (
        SELECT 1 FROM users u JOIN collection_batches b ON b.id=NEW.batch_id
        WHERE u.id=NEW.collector_user_id
          AND u.organization_id=NEW.organization_id
          AND b.organization_id=NEW.organization_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'collection_unlinked_organization_mismatch');
      END;

      CREATE TRIGGER trg_collection_unlinked_link_update
      BEFORE UPDATE OF linked_customer_id,decided_by_user_id,cash_received_by_user_id
      ON collection_unlinked_receipts
      WHEN (NEW.linked_customer_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM customers c
              WHERE c.id=NEW.linked_customer_id AND c.organization_id=NEW.organization_id
            ))
        OR (NEW.decided_by_user_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.id=NEW.decided_by_user_id AND u.organization_id=NEW.organization_id
            ))
        OR (NEW.cash_received_by_user_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM users u
              WHERE u.id=NEW.cash_received_by_user_id AND u.organization_id=NEW.organization_id
            ))
      BEGIN
        SELECT RAISE(ABORT, 'collection_unlinked_organization_mismatch');
      END;
    `,
  },
];
