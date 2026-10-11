import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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
