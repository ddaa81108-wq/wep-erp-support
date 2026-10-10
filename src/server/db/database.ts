import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.ts';

export type AppDatabase = DatabaseSync;

export function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(path: string): AppDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
  `);
  try {
    applyMigrations(database);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

function applyMigrations(database: AppDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Invalid migration plan: expected version ${expectedVersion}, received ${migration.version}.`,
      );
    }
  }
  const appliedRows = database
    .prepare('SELECT version,name FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; name: string }>;
  const knownByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of appliedRows) {
    const known = knownByVersion.get(Number(row.version));
    if (!known) {
      throw new Error(`Database schema version ${row.version} is newer than this application.`);
    }
    if (known.name !== String(row.name) && !known.legacyNames?.includes(String(row.name))) {
      throw new Error(
        `Migration history mismatch at version ${row.version}: expected ${known.name}.`,
      );
    }
  }
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      migration.before?.(database);
      database.exec(migration.sql);
      migration.after?.(database);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, nowIso());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function inImmediateTransaction<T>(database: AppDatabase, work: () => T): T {
  if (database.isTransaction) {
    const savepoint = `nested_${Math.random().toString(36).slice(2)}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = work();
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function databaseHealth(database: AppDatabase) {
  const check = database.prepare('PRAGMA quick_check(1)').get() as Record<string, unknown>;
  const migration = database.prepare(
    'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
  ).get() as { version: number };
  return {
    integrity: String(Object.values(check)[0] ?? 'unknown'),
    schemaVersion: Number(migration.version),
  };
}

export function maintainOperationalData(database: AppDatabase) {
  const now = nowIso();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const oneHundredEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60_000).toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
      .run(now, oneDayAgo);
    database.prepare('DELETE FROM login_failures WHERE occurred_at < ?').run(oneDayAgo);
    database.prepare('DELETE FROM oauth_states WHERE expires_at < ? OR consumed_at IS NOT NULL').run(now);
    // Financial idempotency records are permanent: deleting them could allow an old
    // retried request to be posted a second time after the retention window.
    database.prepare('DELETE FROM event_log WHERE created_at < ?').run(oneHundredEightyDaysAgo);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
