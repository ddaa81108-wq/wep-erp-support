import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

test('daily backup inspection recognizes encrypted backups and fails closed on incomplete metadata', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'abdo-backup-status-'));
  const now = Date.now();
  function fixture(folder: string, name: string, ageHours = 0, changes: Record<string, unknown> = {}) {
    const directory = join(root, folder);
    mkdirSync(directory, { recursive: true });
    const bytes = Buffer.from('synthetic-backup-metadata-fixture');
    const path = join(directory, name);
    writeFileSync(path, bytes);
    const time = new Date(now - ageHours * 3_600_000);
    utimesSync(path, time, time);
    writeFileSync(path + '.json', JSON.stringify({ manifestVersion: 1, file: name,
      fileSizeBytes: bytes.length, integrity: 'ok', foreignKeyProblems: 0,
      sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: time.toISOString(), ...changes }));
    return path;
  }
  try {
    mkdirSync(join(root, 'empty'));
    fixture('legacy', 'old-format.sqlite');
    fixture('encrypted', 'older.sqlite', 72);
    fixture('encrypted', 'fresh.abdobackup');
    writeFileSync(join(root, 'encrypted', 'ignored.abdobackup.tmp'), 'in progress');
    mkdirSync(join(root, 'no-manifest'));
    writeFileSync(join(root, 'no-manifest', 'fresh.abdobackup'), 'incomplete');
    const invalid = fixture('invalid-json', 'fresh.abdobackup');
    writeFileSync(invalid + '.json', '{');
    fixture('wrong-file', 'fresh.abdobackup', 0, { file: 'another.abdobackup' });
    fixture('wrong-size', 'fresh.abdobackup', 0, { fileSizeBytes: 999 });
    fixture('expired', 'old.abdobackup', 72);
    fixture('future', 'future.abdobackup', -2);
    fixture('new-incomplete', 'valid.sqlite', 1);
    const incomplete = fixture('new-incomplete', 'latest.abdobackup');
    writeFileSync(incomplete + '.json', '{}');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      resolve('tests/helpers/inspect-backup-status.ps1'), '-Root', root], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout) as Record<string, { State: string; Count: number; Fresh: boolean; LatestHasManifest: boolean; LatestManifestValid: boolean }>;
    assert.equal(data.missing.State, 'missing');
    assert.equal(data.empty.Fresh, false);
    assert.equal(data.legacy.Fresh, true);
    assert.equal(data.encrypted.Fresh, true);
    assert.equal(data.encrypted.Count, 2);
    assert.equal(data['no-manifest'].LatestHasManifest, false);
    for (const name of ['no-manifest', 'invalid-json', 'wrong-file', 'wrong-size', 'expired', 'future', 'new-incomplete'])
      assert.equal(data[name].Fresh, false, name);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
});
