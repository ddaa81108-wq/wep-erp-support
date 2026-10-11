import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db/database.ts';
import { migrations } from '../src/server/db/migrations.ts';

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function databaseWithMigration(version: number, name: string) {
  const directory = mkdtempSync(join(tmpdir(), 'abdo-erp-migration-safety-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE schema_migrations(
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  database
    .prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
    .run(version, name, new Date().toISOString());
  database.close();
  return path;
}

test('database startup rejects a changed historical migration name', () => {
  const path = databaseWithMigration(1, 'tampered-foundation');
  assert.throws(() => openDatabase(path), /Migration history mismatch at version 1/);
});

test('database startup rejects a schema newer than the application', () => {
  const path = databaseWithMigration(999, 'future-schema');
  assert.throws(() => openDatabase(path), /newer than this application/);
});

test('migration SQL fingerprints survive restart and reject changed historical SQL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'abdo-migration-checksum-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const db = openDatabase(path);
  const before = db.prepare('SELECT sql_sha256 FROM schema_migrations ORDER BY version').all();
  assert.equal(before.length, migrations.length);
  assert.ok(before.every(row => typeof row.sql_sha256 === 'string' && row.sql_sha256.length === 64));
  db.close();
  const reopened = openDatabase(path);
  assert.deepEqual(reopened.prepare('SELECT sql_sha256 FROM schema_migrations ORDER BY version').all(), before);
  reopened.prepare("UPDATE schema_migrations SET sql_sha256='tampered' WHERE version=1").run();
  reopened.close();
  assert.throws(() => openDatabase(path), /Migration SQL checksum mismatch at version 1/);
});

test('schema 42 upgrade preserves balances and existing duplicate phones without merging accounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'abdo-upgrade-preservation-'));
  directories.push(directory);
  const path = join(directory, 'database.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT");
  for (const migration of migrations.filter(item => item.version <= 42)) {
    legacy.exec('BEGIN IMMEDIATE');
    migration.before?.(legacy);
    legacy.exec(migration.sql);
    migration.after?.(legacy);
    legacy.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version, migration.name, new Date().toISOString());
    legacy.exec('COMMIT');
  }
  const now = new Date().toISOString();
  for (const [id, phone] of [['legacy-a', '٠٩١ ٢٣٤-٥٦٧٨'], ['legacy-b', '0912345678']]) {
    legacy.prepare(`INSERT INTO customers(id,name,normalized_name,phone,organization_id,section_key,current_balance_units,created_at,updated_at)
      VALUES(?,?,?,?, 'org-default','customer_debts',125,?,?)`).run(id, id, id, phone, now, now);
  }
  const before = legacy.prepare("SELECT id,phone,current_balance_units FROM customers WHERE id LIKE 'legacy-%' ORDER BY id").all();
  legacy.close();
  const upgraded = openDatabase(path);
  try {
    assert.deepEqual(upgraded.prepare("SELECT id,phone,current_balance_units FROM customers WHERE id LIKE 'legacy-%' ORDER BY id").all(), before);
    assert.deepEqual(upgraded.prepare("SELECT phone_normalized FROM customers WHERE id LIKE 'legacy-%'").all().map(row => row.phone_normalized), ['0912345678', '0912345678']);
    assert.equal(upgraded.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { upgraded.close(); }
});
