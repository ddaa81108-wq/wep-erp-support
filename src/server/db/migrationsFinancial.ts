import type { Migration } from './migrationTypes.ts';

export const financialMigrations: Migration[] = [
  {
    version: 25,
    name: 'scalable-purchases-register',
    sql: `
      CREATE TABLE purchase_merchants (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        merchant_key TEXT NOT NULL CHECK (merchant_key IN ('al_bayan', 'simsim')),
        display_name TEXT NOT NULL,
        next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
        next_day_number INTEGER NOT NULL DEFAULT 1 CHECK (next_day_number > 0),
        created_at TEXT NOT NULL,
        UNIQUE (organization_id, merchant_key),
        UNIQUE (id, organization_id)
      ) STRICT;

      CREATE TABLE purchase_days (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        merchant_id TEXT NOT NULL,
        day_number INTEGER NOT NULL CHECK (day_number > 0),
        business_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
        previous_debt_units INTEGER NOT NULL DEFAULT 0,
        previous_vodafone_units INTEGER NOT NULL DEFAULT 0,
        today_result_units INTEGER NOT NULL DEFAULT 0,
        today_paid_units INTEGER NOT NULL DEFAULT 0,
        today_vodafone_value_units INTEGER NOT NULL DEFAULT 0,
        today_vodafone_consumed_units INTEGER NOT NULL DEFAULT 0,
        total_debt_units INTEGER NOT NULL DEFAULT 0,
        vodafone_remaining_units INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        finalized_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        opened_at TEXT NOT NULL,
        finalized_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (merchant_id, organization_id) REFERENCES purchase_merchants(id, organization_id) ON DELETE RESTRICT,
        UNIQUE (merchant_id, day_number),
        UNIQUE (id, organization_id)
      ) STRICT;
      CREATE UNIQUE INDEX uq_purchase_open_day
        ON purchase_days(organization_id, merchant_id) WHERE status = 'draft';
      CREATE INDEX idx_purchase_days_history
        ON purchase_days(organization_id, merchant_id, day_number DESC);

      CREATE TABLE purchase_entries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        merchant_id TEXT NOT NULL,
        day_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        item_code TEXT NOT NULL CHECK (item_code IN ('vodafone_cash','kafr_el_sheikh','cairo','mansoura','fawry','banks','custom')),
        item_label TEXT NOT NULL,
        egp_value_units INTEGER NOT NULL CHECK (egp_value_units >= 0),
        calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('multiply','divide')),
        exchange_rate_micros INTEGER NOT NULL CHECK (exchange_rate_micros > 0),
        result_units INTEGER NOT NULL CHECK (result_units >= 0),
        paid_units INTEGER NOT NULL DEFAULT 0 CHECK (paid_units >= 0),
        remaining_units INTEGER NOT NULL,
        vodafone_consumed_units INTEGER NOT NULL DEFAULT 0 CHECK (vodafone_consumed_units >= 0),
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (merchant_id, organization_id) REFERENCES purchase_merchants(id, organization_id) ON DELETE RESTRICT,
        FOREIGN KEY (day_id, organization_id) REFERENCES purchase_days(id, organization_id) ON DELETE RESTRICT,
        UNIQUE (merchant_id, sequence)
      ) STRICT;
      CREATE INDEX idx_purchase_entries_feed
        ON purchase_entries(organization_id, merchant_id, sequence DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_purchase_entries_day
        ON purchase_entries(day_id, sequence) WHERE deleted_at IS NULL;

      CREATE TABLE purchase_requests (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, request_id)
      ) WITHOUT ROWID, STRICT;
      CREATE INDEX idx_purchase_requests_created ON purchase_requests(created_at);

      CREATE TRIGGER trg_purchase_day_user_organization
      BEFORE INSERT ON purchase_days
      WHEN NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id = NEW.created_by_user_id AND u.organization_id = NEW.organization_id
      )
      BEGIN SELECT RAISE(ABORT, 'purchase_day_organization_mismatch'); END;

      CREATE TRIGGER trg_purchase_entry_organization
      BEFORE INSERT ON purchase_entries
      WHEN NOT EXISTS (
        SELECT 1 FROM users u JOIN purchase_days d ON d.id = NEW.day_id
        WHERE u.id = NEW.actor_user_id AND u.organization_id = NEW.organization_id
          AND d.organization_id = NEW.organization_id AND d.merchant_id = NEW.merchant_id
      )
      BEGIN SELECT RAISE(ABORT, 'purchase_entry_organization_mismatch'); END;
    `,
  },
  {
    version: 26,
    name: 'purchase-finalized-day-correction-mode',
    sql: `
      ALTER TABLE purchase_days ADD COLUMN correction_open INTEGER NOT NULL DEFAULT 0 CHECK (correction_open IN (0,1));
      ALTER TABLE purchase_days ADD COLUMN correction_opened_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
      ALTER TABLE purchase_days ADD COLUMN correction_opened_at TEXT;
      CREATE INDEX idx_purchase_days_open_correction
        ON purchase_days(organization_id, merchant_id, correction_open)
        WHERE correction_open = 1;
    `,
  },
  {
    version: 27,
    name: 'purchase-request-fingerprints-and-update-boundaries',
    sql: `
      ALTER TABLE purchase_requests ADD COLUMN request_fingerprint TEXT;

      CREATE TRIGGER trg_purchase_day_actor_organization_insert_v27
      BEFORE INSERT ON purchase_days
      WHEN NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.created_by_user_id AND u.organization_id = NEW.organization_id
      ) OR (
        NEW.finalized_by_user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = NEW.finalized_by_user_id AND u.organization_id = NEW.organization_id
        )
      ) OR (
        NEW.correction_opened_by_user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = NEW.correction_opened_by_user_id AND u.organization_id = NEW.organization_id
        )
      )
      BEGIN SELECT RAISE(ABORT, 'purchase_day_actor_organization_mismatch'); END;

      CREATE TRIGGER trg_purchase_day_organization_update_v27
      BEFORE UPDATE OF organization_id, merchant_id, created_by_user_id,
        finalized_by_user_id, correction_opened_by_user_id ON purchase_days
      WHEN NOT EXISTS (
        SELECT 1 FROM purchase_merchants m
        WHERE m.id = NEW.merchant_id AND m.organization_id = NEW.organization_id
      ) OR NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.created_by_user_id AND u.organization_id = NEW.organization_id
      ) OR (
        NEW.finalized_by_user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = NEW.finalized_by_user_id AND u.organization_id = NEW.organization_id
        )
      ) OR (
        NEW.correction_opened_by_user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = NEW.correction_opened_by_user_id AND u.organization_id = NEW.organization_id
        )
      )
      BEGIN SELECT RAISE(ABORT, 'purchase_day_organization_mismatch'); END;

      CREATE TRIGGER trg_purchase_entry_organization_update_v27
      BEFORE UPDATE OF organization_id, merchant_id, day_id, actor_user_id ON purchase_entries
      WHEN NOT EXISTS (
        SELECT 1 FROM users u JOIN purchase_days d ON d.id = NEW.day_id
        WHERE u.id = NEW.actor_user_id AND u.organization_id = NEW.organization_id
          AND d.organization_id = NEW.organization_id AND d.merchant_id = NEW.merchant_id
      )
      BEGIN SELECT RAISE(ABORT, 'purchase_entry_organization_mismatch'); END;
    `,
  },
  {
    version: 28,
    name: 'treasury-aggregate-dashboard-and-active-cash-ledger',
    sql: `
      CREATE TABLE treasury_cash_accounts (
        organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
        balance_units INTEGER NOT NULL DEFAULT 0,
        next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE treasury_cash_entries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        direction TEXT NOT NULL CHECK (direction IN ('in','out')),
        amount_units INTEGER NOT NULL CHECK (amount_units > 0),
        description TEXT NOT NULL DEFAULT '',
        balance_before_units INTEGER NOT NULL,
        balance_after_units INTEGER NOT NULL,
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        UNIQUE (organization_id, sequence)
      ) STRICT;
      CREATE INDEX idx_treasury_cash_entries_feed
        ON treasury_cash_entries(organization_id, sequence DESC, id DESC);

      CREATE TABLE treasury_cash_requests (
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        request_id TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, request_id)
      ) WITHOUT ROWID, STRICT;

      CREATE TRIGGER trg_treasury_cash_entry_organization_insert
      BEFORE INSERT ON treasury_cash_entries
      WHEN NOT EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = NEW.actor_user_id AND u.organization_id = NEW.organization_id
      )
      BEGIN SELECT RAISE(ABORT, 'treasury_cash_entry_organization_mismatch'); END;

      CREATE INDEX idx_customers_treasury_aggregate
        ON customers(organization_id, section_key, current_balance_units)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    version: 29,
    name: 'read-only-general-financial-ledger',
    sql: `
      CREATE TABLE financial_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        section_key TEXT NOT NULL,
        entry_kind TEXT NOT NULL,
        counterparty_name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        reference_no TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL CHECK (currency IN ('LYD','EGP')),
        amount_units INTEGER NOT NULL CHECK (amount_units >= 0),
        effect_units INTEGER NOT NULL,
        actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
        occurred_at TEXT NOT NULL,
        source_status TEXT NOT NULL DEFAULT 'posted',
        updated_at TEXT NOT NULL,
        UNIQUE (source_kind, source_id)
      ) STRICT;
      CREATE INDEX idx_financial_ledger_feed
        ON financial_ledger_entries(organization_id, occurred_at DESC, id DESC);
      CREATE INDEX idx_financial_ledger_section_feed
        ON financial_ledger_entries(organization_id, section_key, occurred_at DESC, id DESC);
      CREATE INDEX idx_financial_ledger_currency_feed
        ON financial_ledger_entries(organization_id, currency, occurred_at DESC, id DESC);

      INSERT INTO financial_ledger_entries(
        organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
        description,reference_no,currency,amount_units,effect_units,actor_user_id,
        occurred_at,source_status,updated_at
      )
      SELECT c.organization_id,'debt_transaction',t.id,c.section_key,t.entry_type,c.name,
        t.note,t.reference_no,t.currency,
        CAST((t.amount_units * t.conversion_rate_micros) / 1000000 AS INTEGER),
        CASE WHEN t.deleted_at IS NULL AND t.transaction_status='posted'
          THEN (CASE t.entry_type WHEN 'debt' THEN 1 ELSE -1 END) *
            CAST((t.amount_units * t.conversion_rate_micros) / 1000000 AS INTEGER)
          ELSE 0 END,
        t.actor_user_id,t.transaction_date,
        CASE WHEN t.deleted_at IS NOT NULL THEN 'deleted' ELSE t.transaction_status END,t.updated_at
      FROM debt_transactions t JOIN customers c ON c.id=t.customer_id
      ORDER BY t.transaction_date,t.created_at,t.id;

      INSERT INTO financial_ledger_entries(
        organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
        description,reference_no,currency,amount_units,effect_units,actor_user_id,
        occurred_at,source_status,updated_at
      )
      SELECT e.organization_id,'purchase_entry',e.id,'purchases','purchase',m.display_name,
        e.item_label,'PUR-' || e.sequence,'LYD',e.result_units,
        CASE WHEN e.deleted_at IS NULL THEN e.remaining_units ELSE 0 END,e.actor_user_id,
        e.created_at,CASE WHEN e.deleted_at IS NULL THEN d.status ELSE 'deleted' END,e.updated_at
      FROM purchase_entries e
      JOIN purchase_merchants m ON m.id=e.merchant_id
      JOIN purchase_days d ON d.id=e.day_id
      ORDER BY e.created_at,e.id;

      INSERT INTO financial_ledger_entries(
        organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
        description,reference_no,currency,amount_units,effect_units,actor_user_id,
        occurred_at,source_status,updated_at
      )
      SELECT d.organization_id,'masraweya_day',d.id,'masraweya','daily_purchases','المصراوية',
        'مشتريات اليوم',d.business_date,'EGP',d.purchases_units,d.purchases_units,
        d.updated_by_user_id,d.updated_at,d.status,d.updated_at
      FROM masraweya_days d
      ORDER BY d.updated_at,d.id;

      INSERT INTO financial_ledger_entries(
        organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
        description,reference_no,currency,amount_units,effect_units,actor_user_id,
        occurred_at,source_status,updated_at
      )
      SELECT d.organization_id,'masraweya_entry',e.id,'masraweya','daily_work','المصراوية',
        'شغل اليوم','MAS-' || d.business_date || '-' || e.sequence,'EGP',
        e.value_units + e.commission_units,-(e.value_units + e.commission_units),
        d.updated_by_user_id,e.created_at,d.status,e.updated_at
      FROM masraweya_entries e JOIN masraweya_days d ON d.id=e.day_id
      ORDER BY e.created_at,e.id;

      INSERT INTO financial_ledger_entries(
        organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
        description,reference_no,currency,amount_units,effect_units,actor_user_id,
        occurred_at,source_status,updated_at
      )
      SELECT organization_id,'treasury_cash',id,'treasury',direction,'الخزينة',description,
        'CASH-' || sequence,'LYD',amount_units,
        CASE direction WHEN 'in' THEN amount_units ELSE -amount_units END,
        actor_user_id,created_at,'posted',created_at
      FROM treasury_cash_entries ORDER BY created_at,id;

      CREATE TRIGGER trg_financial_ledger_debt_insert AFTER INSERT ON debt_transactions
      BEGIN
        INSERT INTO financial_ledger_entries(
          organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
          description,reference_no,currency,amount_units,effect_units,actor_user_id,
          occurred_at,source_status,updated_at
        ) SELECT c.organization_id,'debt_transaction',NEW.id,c.section_key,NEW.entry_type,c.name,
          NEW.note,NEW.reference_no,NEW.currency,
          CAST((NEW.amount_units * NEW.conversion_rate_micros) / 1000000 AS INTEGER),
          CASE WHEN NEW.deleted_at IS NULL AND NEW.transaction_status='posted'
            THEN (CASE NEW.entry_type WHEN 'debt' THEN 1 ELSE -1 END) *
              CAST((NEW.amount_units * NEW.conversion_rate_micros) / 1000000 AS INTEGER)
            ELSE 0 END,
          NEW.actor_user_id,NEW.transaction_date,
          CASE WHEN NEW.deleted_at IS NOT NULL THEN 'deleted' ELSE NEW.transaction_status END,NEW.updated_at
        FROM customers c WHERE c.id=NEW.customer_id;
      END;
      CREATE TRIGGER trg_financial_ledger_debt_update AFTER UPDATE ON debt_transactions
      BEGIN
        UPDATE financial_ledger_entries SET
          organization_id=(SELECT organization_id FROM customers WHERE id=NEW.customer_id),
          section_key=(SELECT section_key FROM customers WHERE id=NEW.customer_id),
          entry_kind=NEW.entry_type,
          counterparty_name=(SELECT name FROM customers WHERE id=NEW.customer_id),
          description=NEW.note,reference_no=NEW.reference_no,currency=NEW.currency,
          amount_units=CAST((NEW.amount_units * NEW.conversion_rate_micros) / 1000000 AS INTEGER),
          effect_units=CASE WHEN NEW.deleted_at IS NULL AND NEW.transaction_status='posted'
            THEN (CASE NEW.entry_type WHEN 'debt' THEN 1 ELSE -1 END) *
              CAST((NEW.amount_units * NEW.conversion_rate_micros) / 1000000 AS INTEGER)
            ELSE 0 END,
          actor_user_id=NEW.actor_user_id,occurred_at=NEW.transaction_date,
          source_status=CASE WHEN NEW.deleted_at IS NOT NULL THEN 'deleted' ELSE NEW.transaction_status END,
          updated_at=NEW.updated_at
        WHERE source_kind='debt_transaction' AND source_id=NEW.id;
      END;
      CREATE TRIGGER trg_financial_ledger_debt_delete AFTER DELETE ON debt_transactions
      BEGIN
        DELETE FROM financial_ledger_entries WHERE source_kind='debt_transaction' AND source_id=OLD.id;
      END;
      CREATE TRIGGER trg_financial_ledger_customer_name_update AFTER UPDATE OF name ON customers
      BEGIN
        UPDATE financial_ledger_entries SET counterparty_name=NEW.name,updated_at=NEW.updated_at
        WHERE source_kind='debt_transaction' AND source_id IN (
          SELECT id FROM debt_transactions WHERE customer_id=NEW.id
        );
      END;

      CREATE TRIGGER trg_financial_ledger_purchase_insert AFTER INSERT ON purchase_entries
      BEGIN
        INSERT INTO financial_ledger_entries(
          organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
          description,reference_no,currency,amount_units,effect_units,actor_user_id,
          occurred_at,source_status,updated_at
        ) SELECT NEW.organization_id,'purchase_entry',NEW.id,'purchases','purchase',m.display_name,
          NEW.item_label,'PUR-' || NEW.sequence,'LYD',NEW.result_units,
          CASE WHEN NEW.deleted_at IS NULL THEN NEW.remaining_units ELSE 0 END,NEW.actor_user_id,
          NEW.created_at,CASE WHEN NEW.deleted_at IS NULL THEN d.status ELSE 'deleted' END,NEW.updated_at
        FROM purchase_merchants m JOIN purchase_days d ON d.id=NEW.day_id WHERE m.id=NEW.merchant_id;
      END;
      CREATE TRIGGER trg_financial_ledger_purchase_update AFTER UPDATE ON purchase_entries
      BEGIN
        UPDATE financial_ledger_entries SET
          organization_id=NEW.organization_id,
          counterparty_name=(SELECT display_name FROM purchase_merchants WHERE id=NEW.merchant_id),
          description=NEW.item_label,reference_no='PUR-' || NEW.sequence,
          amount_units=NEW.result_units,
          effect_units=CASE WHEN NEW.deleted_at IS NULL THEN NEW.remaining_units ELSE 0 END,
          actor_user_id=NEW.actor_user_id,
          source_status=CASE WHEN NEW.deleted_at IS NULL
            THEN (SELECT status FROM purchase_days WHERE id=NEW.day_id) ELSE 'deleted' END,
          updated_at=NEW.updated_at
        WHERE source_kind='purchase_entry' AND source_id=NEW.id;
      END;
      CREATE TRIGGER trg_financial_ledger_purchase_delete AFTER DELETE ON purchase_entries
      BEGIN
        DELETE FROM financial_ledger_entries WHERE source_kind='purchase_entry' AND source_id=OLD.id;
      END;
      CREATE TRIGGER trg_financial_ledger_purchase_day_update AFTER UPDATE OF status ON purchase_days
      BEGIN
        UPDATE financial_ledger_entries SET source_status=NEW.status,updated_at=NEW.updated_at
        WHERE source_kind='purchase_entry' AND source_id IN (
          SELECT id FROM purchase_entries WHERE day_id=NEW.id AND deleted_at IS NULL
        );
      END;

      CREATE TRIGGER trg_financial_ledger_masraweya_day_insert AFTER INSERT ON masraweya_days
      BEGIN
        INSERT INTO financial_ledger_entries(
          organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
          description,reference_no,currency,amount_units,effect_units,actor_user_id,
          occurred_at,source_status,updated_at
        ) VALUES(NEW.organization_id,'masraweya_day',NEW.id,'masraweya','daily_purchases','المصراوية',
          'مشتريات اليوم',NEW.business_date,'EGP',NEW.purchases_units,NEW.purchases_units,
          NEW.updated_by_user_id,NEW.updated_at,NEW.status,NEW.updated_at);
      END;
      CREATE TRIGGER trg_financial_ledger_masraweya_day_update AFTER UPDATE ON masraweya_days
      BEGIN
        UPDATE financial_ledger_entries SET amount_units=NEW.purchases_units,effect_units=NEW.purchases_units,
          actor_user_id=NEW.updated_by_user_id,occurred_at=NEW.updated_at,source_status=NEW.status,
          updated_at=NEW.updated_at,reference_no=NEW.business_date
        WHERE source_kind='masraweya_day' AND source_id=NEW.id;
        UPDATE financial_ledger_entries SET actor_user_id=NEW.updated_by_user_id,
          source_status=NEW.status,updated_at=NEW.updated_at
        WHERE source_kind='masraweya_entry' AND source_id IN (
          SELECT id FROM masraweya_entries WHERE day_id=NEW.id
        );
      END;
      CREATE TRIGGER trg_financial_ledger_masraweya_day_delete AFTER DELETE ON masraweya_days
      BEGIN
        DELETE FROM financial_ledger_entries WHERE source_kind='masraweya_day' AND source_id=OLD.id;
      END;
      CREATE TRIGGER trg_financial_ledger_masraweya_entry_insert AFTER INSERT ON masraweya_entries
      BEGIN
        INSERT INTO financial_ledger_entries(
          organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
          description,reference_no,currency,amount_units,effect_units,actor_user_id,
          occurred_at,source_status,updated_at
        ) SELECT d.organization_id,'masraweya_entry',NEW.id,'masraweya','daily_work','المصراوية',
          'شغل اليوم','MAS-' || d.business_date || '-' || NEW.sequence,'EGP',
          NEW.value_units + NEW.commission_units,-(NEW.value_units + NEW.commission_units),
          d.updated_by_user_id,NEW.created_at,d.status,NEW.updated_at
        FROM masraweya_days d WHERE d.id=NEW.day_id;
      END;
      CREATE TRIGGER trg_financial_ledger_masraweya_entry_update AFTER UPDATE ON masraweya_entries
      BEGIN
        UPDATE financial_ledger_entries SET
          reference_no='MAS-' || (SELECT business_date FROM masraweya_days WHERE id=NEW.day_id) || '-' || NEW.sequence,
          amount_units=NEW.value_units + NEW.commission_units,
          effect_units=-(NEW.value_units + NEW.commission_units),updated_at=NEW.updated_at
        WHERE source_kind='masraweya_entry' AND source_id=NEW.id;
      END;
      CREATE TRIGGER trg_financial_ledger_masraweya_entry_delete AFTER DELETE ON masraweya_entries
      BEGIN
        DELETE FROM financial_ledger_entries WHERE source_kind='masraweya_entry' AND source_id=OLD.id;
      END;

      CREATE TRIGGER trg_financial_ledger_cash_insert AFTER INSERT ON treasury_cash_entries
      BEGIN
        INSERT INTO financial_ledger_entries(
          organization_id,source_kind,source_id,section_key,entry_kind,counterparty_name,
          description,reference_no,currency,amount_units,effect_units,actor_user_id,
          occurred_at,source_status,updated_at
        ) VALUES(NEW.organization_id,'treasury_cash',NEW.id,'treasury',NEW.direction,'الخزينة',
          NEW.description,'CASH-' || NEW.sequence,'LYD',NEW.amount_units,
          CASE NEW.direction WHEN 'in' THEN NEW.amount_units ELSE -NEW.amount_units END,
          NEW.actor_user_id,NEW.created_at,'posted',NEW.created_at);
      END;
      CREATE TRIGGER trg_financial_ledger_cash_delete AFTER DELETE ON treasury_cash_entries
      BEGIN
        DELETE FROM financial_ledger_entries WHERE source_kind='treasury_cash' AND source_id=OLD.id;
      END;
    `,
  },
  {
    version: 30,
    name: 'protected-egp-linked-accounts',
    sql: `
      ALTER TABLE customers ADD COLUMN system_link_key TEXT;
      DROP INDEX uq_customers_section_name;
      CREATE UNIQUE INDEX uq_customers_section_name
        ON customers(organization_id,section_key,normalized_name) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_customers_system_link
        ON customers(organization_id, system_link_key) WHERE system_link_key IS NOT NULL;

      INSERT INTO customers(
        id,name,normalized_name,phone,account_type,organization_id,is_pinned,inactive_since,
        ledger_next_sequence,section_key,current_balance_units,debt_started_at,financial_updated_at,
        version,created_at,updated_at,system_link_key
      )
      SELECT 'system-egp-masraweya:' || id,'قسم المصراوية','__system_egp_masraweya__',NULL,
        'customer',id,1,CURRENT_TIMESTAMP,1,'egyptian_deposits',0,NULL,CURRENT_TIMESTAMP,
        1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'masraweya_remainder'
      FROM organizations;
      INSERT INTO customer_cycles(
        id,customer_id,status,start_date,initial_balance_units,currency,created_at,updated_at
      )
      SELECT 'system-egp-masraweya-cycle:' || id,'system-egp-masraweya:' || id,'active',
        CURRENT_TIMESTAMP,0,'EGP',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      FROM organizations;

      INSERT INTO customers(
        id,name,normalized_name,phone,account_type,organization_id,is_pinned,inactive_since,
        ledger_next_sequence,section_key,current_balance_units,debt_started_at,financial_updated_at,
        version,created_at,updated_at,system_link_key
      )
      SELECT 'system-egp-vodafone:' || id,'فودافون قسم المشتريات','__system_egp_vodafone__',NULL,
        'customer',id,1,CURRENT_TIMESTAMP,1,'egyptian_deposits',0,NULL,CURRENT_TIMESTAMP,
        1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'purchases_vodafone_remainder'
      FROM organizations;
      INSERT INTO customer_cycles(
        id,customer_id,status,start_date,initial_balance_units,currency,created_at,updated_at
      )
      SELECT 'system-egp-vodafone-cycle:' || id,'system-egp-vodafone:' || id,'active',
        CURRENT_TIMESTAMP,0,'EGP',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      FROM organizations;

      UPDATE customers AS linked SET
        current_balance_units=COALESCE((
          SELECT d.previous_value_units + d.purchases_units - COALESCE((
            SELECT SUM(e.value_units + e.commission_units)
            FROM masraweya_entries e WHERE e.day_id=d.id
          ),0)
          FROM masraweya_days d WHERE d.organization_id=linked.organization_id
          ORDER BY d.business_date DESC,d.updated_at DESC LIMIT 1
        ),0)
      WHERE linked.system_link_key='masraweya_remainder';

      UPDATE customers AS linked SET
        current_balance_units=COALESCE((
          SELECT SUM(d.vodafone_remaining_units) FROM purchase_days d
          WHERE d.organization_id=linked.organization_id AND d.day_number=(
            SELECT MAX(latest.day_number) FROM purchase_days latest
            WHERE latest.organization_id=d.organization_id AND latest.merchant_id=d.merchant_id
          )
        ),0)
      WHERE linked.system_link_key='purchases_vodafone_remainder';

      CREATE TRIGGER trg_system_link_identity_protection
      BEFORE UPDATE OF name,normalized_name,phone,account_type,organization_id,section_key,
        system_link_key,deleted_at ON customers
      WHEN OLD.system_link_key IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'system_link_account_protected'); END;
      CREATE TRIGGER trg_system_link_delete_protection BEFORE DELETE ON customers
      WHEN OLD.system_link_key IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'system_link_account_protected'); END;
    `,
  },
];
