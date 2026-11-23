import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, utimesSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneBackupSidecars } from '../scripts/backup-sidecars.mjs';

test('sidecar cleanup removes only old generated orphan empty WAL pairs and defaults to preview', () => {
  const root = mkdtempSync(join(tmpdir(), 'backup-sidecars-')), now = Date.now();
  const name = (i: number) => `abdo-erp-2026-01-01T00-00-00-${String(i).padStart(3, '0')}Z.sqlite`;
  const write = (file: string, value: string | Buffer = '', age = 2 * 86_400_000) => {
    const path = join(root, file); writeFileSync(path, value); utimesSync(path, new Date(now - age), new Date(now - age)); return path;
  };
  try {
    write(name(1) + '-wal'); write(name(1) + '-shm', Buffer.alloc(32768));
    write(name(1).replace('.sqlite', '.abdobackup'), 'encrypted fixture');
    write(name(2) + '-wal', 'uncheckpointed data'); write(name(2) + '-shm');
    write(name(3) + '-wal'); write(name(3), 'live database fixture');
    write(name(4) + '-wal', '', 1000); write(name(4) + '-shm');
    write(name(5) + '-wal'); write(name(5) + '-shm', '', 1000);
    write('abdo-erp.sqlite-wal'); write('unrelated.sqlite-wal');
    mkdirSync(join(root, name(6) + '-wal'));
    const preview = pruneBackupSidecars(root, { now });
    assert.deepEqual(preview.eligible, [name(1) + '-wal']);
    assert.deepEqual(preview.removed, []);
    assert.ok(existsSync(join(root, name(1) + '-shm')));
    const result = pruneBackupSidecars(root, { remove: true, now });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.removed.length, 2);
    for (const file of [name(2) + '-wal', name(3), name(3) + '-wal', name(4) + '-wal', name(5) + '-shm', 'abdo-erp.sqlite-wal', 'unrelated.sqlite-wal', name(1).replace('.sqlite', '.abdobackup')])
      assert.ok(existsSync(join(root, file)), file);
    assert.deepEqual(pruneBackupSidecars(root, { remove: true, now }).removed, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
