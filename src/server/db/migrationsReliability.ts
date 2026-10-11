import type { Migration } from './migrationTypes.ts';
import { phoneKey } from '../../shared/phone.ts';

export const reliabilityMigrations: Migration[] = [
  {
    version: 43,
    name: 'request-fingerprints-phone-keys-and-migration-checksums',
    sql: `
    ALTER TABLE idempotency_keys ADD COLUMN request_fingerprint TEXT;
    ALTER TABLE customers ADD COLUMN phone_normalized TEXT;
    CREATE INDEX idx_customers_phone_normalized
      ON customers(organization_id,section_key,phone_normalized) WHERE deleted_at IS NULL;
    ALTER TABLE schema_migrations ADD COLUMN sql_sha256 TEXT;
  `,
    after(database) {
      // Preserve all existing identities, including any pre-existing duplicates.
      const update = database.prepare('UPDATE customers SET phone_normalized=? WHERE id=?');
      for (const row of database.prepare('SELECT id,phone FROM customers').all()) {
        update.run(phoneKey(row.phone), String(row.id));
      }
    },
  },
];
