import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupCapacityFor, BACKUP_DOWNLOAD_LIMIT_BYTES } from '../src/shared/backupPolicy.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { databaseMonitor } from '../src/server/domain/databaseMonitor.ts';
import { loadConfig } from '../src/server/config.ts';

test('backup capacity warns before the limit and distinguishes a still-supported exact limit', () => {
  const threshold = Math.floor(BACKUP_DOWNLOAD_LIMIT_BYTES * .8);
  assert.equal(backupCapacityFor(threshold - 1).level, 'ok');
  assert.equal(backupCapacityFor(threshold).level, 'warning');
  assert.equal(backupCapacityFor(BACKUP_DOWNLOAD_LIMIT_BYTES).level, 'warning');
  assert.equal(backupCapacityFor(BACKUP_DOWNLOAD_LIMIT_BYTES + 1).level, 'limit');
});

test('monitor counts encrypted scheduled backups and their reports, without opening or changing them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'erp-encrypted-monitor-'));
  const db = openDatabase(':memory:');
  try {
    const folder = join(root, 'backups'); mkdirSync(folder);
    const file = 'abdo-erp-test.abdobackup';
    writeFileSync(join(folder, file), 'encrypted-test');
    writeFileSync(join(folder, file + '.json'), JSON.stringify({ manifestVersion: 1, file, fileSizeBytes: 14, integrity: 'ok', foreignKeyProblems: 0, sha256: 'a'.repeat(64), schemaVersion: 60, createdAt: new Date().toISOString() }));
    const before = db.prepare('SELECT total_changes() n').get()!.n;
    const result = await databaseMonitor(db, loadConfig({ databasePath: ':memory:', backupDirectory: folder }));
    assert.equal(result.backups.count, 1);
    assert.equal(result.backups.items[0].report, 'recorded');
    assert.equal(result.backupCapacity.level, 'ok');
    assert.equal(db.prepare('SELECT total_changes() n').get()!.n, before);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
