import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../../src/server/db/database.ts';
import { migrations } from '../../src/server/db/migrations.ts';

/** Historical schema for version-specific rollback tests; never downgrade a live DB. */
export function openSchemaFixture(path: string, version: number) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  try { applyMigrations(db, migrations.filter(migration => migration.version <= version)); }
  catch (error) { db.close(); throw error; }
  return db;
}
