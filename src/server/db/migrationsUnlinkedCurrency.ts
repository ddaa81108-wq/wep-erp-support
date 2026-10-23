import type { Migration } from './migrationTypes.ts';

export const unlinkedCurrencyMigrations: Migration[] = [
  {
    version: 52,
    name: 'fix-unlinked-receipt-currency-to-lyd',
    sql: `ALTER TABLE collection_unlinked_receipts
    ADD COLUMN currency TEXT NOT NULL DEFAULT 'LYD' CHECK(currency='LYD');`,
  },
];
