import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from '../src/server/db/migrations.ts';
import { SCHEMA_VERSION } from '../src/server/config.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createEmergencyBackup, validateBackupFile, stageRestore } from '../src/server/domain/emergencyBackup.ts';

test('emergency backup preserves all tables and rejects corrupted restore packages before queueing', async () => {
  const db = openDatabase(':memory:');
  const owner = { ...fixtureAdmin(db), isOwner: true };
  const root = mkdtempSync(join(tmpdir(), 'abdo-backup-test-'));
  const previous = process.env.ABDO_RESTORE_ROOT;
  process.env.ABDO_RESTORE_ROOT = root;
  try {
    const snapshot = db.prepare('SELECT id,username FROM users ORDER BY id').all();
    const value = await createEmergencyBackup(db, owner);
    const path = join(root, 'roundtrip.sqlite');
    writeFileSync(path, Buffer.from(value.database, 'base64'));
    validateBackupFile(path, owner.organizationId);
    const restored = openDatabase(path);
    try { assert.deepEqual(restored.prepare('SELECT id,username FROM users ORDER BY id').all(), snapshot); }
    finally { restored.close(); }
    const legacyPath = join(root, 'schema47.sqlite');
    copyFileSync(path, legacyPath);
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('DROP TRIGGER trg_notification_browser_push; DROP TABLE browser_push_outbox; DROP TABLE browser_push_subscriptions; DELETE FROM schema_migrations WHERE version=48;');
    legacy.exec(migrations.find(migration => migration.version === 47)!.sql);
    legacy.close();
    validateBackupFile(legacyPath, owner.organizationId);
    const migrated = new DatabaseSync(legacyPath, { readOnly: true });
    assert.equal(migrated.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v, Number(SCHEMA_VERSION));
    migrated.close();
    await assert.rejects(createEmergencyBackup(db, { ...owner, isOwner: false }));
    if (process.platform === 'win32') {
      assert.throws(() => stageRestore(db, owner, { confirmation: 'استعادة', backup: { ...value, sha256: '0'.repeat(64) } }));
      assert.equal(existsSync(join(root, 'pending.json')), false);
      assert.throws(() => stageRestore(db, owner, { confirmation: '', backup: value }));
      assert.equal(stageRestore(db, owner, { confirmation: 'استعادة', backup: value }).queued, true);
      assert.throws(() => stageRestore(db, owner, { confirmation: 'استعادة', backup: value }));
    }
  } finally {
    if (previous === undefined) delete process.env.ABDO_RESTORE_ROOT; else process.env.ABDO_RESTORE_ROOT = previous;
    db.close(); rmSync(root, { recursive: true, force: true });
  }
});
