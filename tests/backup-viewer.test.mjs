import { test } from 'node:test';
/* global fetch, URL */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encryptBackup } from '../src/server/security/backupEncryption.ts';
import { readBackup, startViewer } from '../tools/backup-viewer/viewer.mjs';

test('standalone backup viewer: encryption, validation, read-only browsing, paging and cleanup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-viewer-test-'));
  let viewer;
  try {
    const source = join(directory, 'sample.sqlite');
    const db = new DatabaseSync(source);
    db.exec('CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,balance INTEGER); CREATE TABLE users(username TEXT,password_hash TEXT); CREATE TABLE sessions(token TEXT);');
    for (let i = 1; i <= 65; i++) db.prepare('INSERT INTO customers VALUES(?,?,?)').run(i, i === 1 ? '<script>test</script> عميل' : 'عميل تجريبي ' + i, BigInt(i) * 1000n);
    db.prepare('INSERT INTO users VALUES(?,?)').run('demo', 'hidden-test-password');
    db.prepare('INSERT INTO sessions VALUES(?)').run('hidden-test-token');
    db.close();
    const bytes = readFileSync(source);
    const password = 'Synthetic test password 123!';
    const encrypted = await encryptBackup(bytes, password);
    const file = join(directory, 'sample.abdobackup');
    writeFileSync(file, JSON.stringify(encrypted));
    const original = readFileSync(file);
    writeFileSync(file + '.json', JSON.stringify({ manifestVersion: 1, file: 'sample.abdobackup', fileSizeBytes: original.length, sha256: createHash('sha256').update(original).digest('hex') }));
    assert.throws(() => readBackup({ backupPath: file, password: 'wrong password 123456' }), /غير صحيحة/);
    const plain = readBackup({ backupPath: source });
    assert.deepEqual(plain.bytes, bytes);
    const legacy = join(directory, 'legacy.json');
    writeFileSync(legacy, JSON.stringify({ format: 'abdo-erp-backup', version: 1, database: bytes.toString('base64'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    assert.deepEqual(readBackup({ backupPath: legacy }).bytes, bytes);
    viewer = await startViewer({ backupPath: file, password });
    assert.ok(existsSync(viewer.directory));
    const metadata = await (await fetch(viewer.url + 'api/tables')).json();
    assert.equal(metadata.metadata.integrity, 'ok');
    assert.equal(metadata.metadata.encrypted, true);
    assert.equal(metadata.tables.find(t => t.name === 'customers').count, 65);
    assert.ok(!metadata.tables.some(t => t.name === 'sessions'));
    assert.deepEqual(metadata.tables.find(t => t.name === 'users').columns, ['username']);
    let rows = await (await fetch(viewer.url + 'api/rows?table=customers&page=2')).json();
    assert.equal(rows.rows.length, 15);
    assert.equal(rows.rows[0].id, '51');
    rows = await (await fetch(viewer.url + 'api/rows?table=customers&search=' + encodeURIComponent('<script>'))).json();
    assert.equal(rows.total, 1);
    assert.equal(rows.rows[0].balance, '1000');
    assert.equal((await fetch(viewer.url + 'api/rows?table=' + encodeURIComponent('customers;DROP TABLE users'))).status, 400);
    assert.equal((await fetch(viewer.url + 'api/tables', { method: 'POST' })).status, 405);
    assert.equal((await fetch(viewer.url + 'api/tables', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(new URL('/', viewer.url))).status, 404);
    assert.deepEqual(readFileSync(file), original, 'The original encrypted backup is unchanged');
    assert.deepEqual(readFileSync(source), bytes, 'The original SQLite is unchanged');
    const temp = viewer.directory;
    const response = await fetch(viewer.url + 'api/close', { method: 'POST' });
    assert.equal(response.status, 200);
    await viewer.close();
    assert.ok(!existsSync(temp));
    viewer = null;
    writeFileSync(file, original.toString() + ' ');
    assert.throws(() => readBackup({ backupPath: file, password }), /لا تطابق/);
  } finally {
    if (viewer) await viewer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
