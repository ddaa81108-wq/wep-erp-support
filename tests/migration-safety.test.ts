import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db/database.ts';

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
