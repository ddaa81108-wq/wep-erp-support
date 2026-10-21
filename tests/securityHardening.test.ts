import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { encryptBackup, decryptBackup } from '../src/server/security/backupEncryption.ts';
import { base32, totp, beginMfa, confirmMfa, hasMfa, verifyMfa, createMfaChallenge, consumeMfaChallenge } from '../src/server/security/mfa.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { EventHub, MAX_EVENT_STREAMS_PER_USER } from '../src/server/events.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { AddressInfo } from 'node:net';
import { createEncryptedEmergencyBackup, restoreBackup, validateBackupFile } from '../src/server/domain/emergencyBackup.ts';

test('backup encryption rejects wrong passwords, tampering, weak passwords and hostile parameters', async () => {
  const source = Buffer.from('Private financial snapshot'), password = 'Test backup passphrase 123';
  const value = await encryptBackup(source, password);
  assert.equal(JSON.stringify(value).includes(source.toString()), false);
  assert.deepEqual(await decryptBackup(value, password), source);
  assert.notEqual((await encryptBackup(source, password)).ciphertext, value.ciphertext);
  await assert.rejects(decryptBackup(value, 'Wrong password 123'));
  const bytes = Buffer.from(value.ciphertext, 'base64'); bytes[0] ^= 1;
  await assert.rejects(decryptBackup({ ...value, ciphertext: bytes.toString('base64') }, password));
  await assert.rejects(decryptBackup({ ...value, iv: 'AA==' }, password));
  await assert.rejects(decryptBackup({ ...value, kdf: 'arbitrary' }, password));
  await assert.rejects(encryptBackup(source, 'short'));
});

test('encrypted scheduled and emergency backups restore full SQLite data without plaintext output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'abdo-encrypted-test-')), db = openDatabase(join(root, 'source.sqlite'));
  const previous = process.env.ABDO_RESTORE_ROOT;
  process.env.ABDO_RESTORE_ROOT = join(root, 'restore');
  try {
    const owner = { ...fixtureAdmin(db), isOwner: true }, password = 'Test encrypted backup 12345';
    const value = await createEncryptedEmergencyBackup(db, owner, password);
    const restoredPath = join(root, 'restored.sqlite');
    writeFileSync(restoredPath, await decryptBackup(value, password));
    validateBackupFile(restoredPath, owner.organizationId);
    const restored = openDatabase(restoredPath);
    try { assert.deepEqual(restored.prepare('SELECT * FROM users').all(), db.prepare('SELECT * FROM users').all()); } finally { restored.close(); }
    if (process.platform === 'win32') {
      await assert.rejects(restoreBackup(db, owner, { confirmation: 'استعادة', backup: value, password: 'Wrong password 123' }));
      assert.equal(existsSync(join(root, 'restore', 'pending.json')), false);
      assert.equal((await restoreBackup(db, owner, { confirmation: 'استعادة', backup: value, password })).queued, true);
    }
    const key = join(root, 'key'); writeFileSync(key, password);
    const output = join(root, 'backups');
    const run = spawnSync(process.execPath, [resolve('scripts/backup-database.mjs'), join(root, 'source.sqlite'), output, '3', key], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(readdirSync(output).some(name => name.endsWith('.sqlite')), false);
    const encrypted = JSON.parse(readFileSync(result.outputPath, 'utf8'));
    writeFileSync(restoredPath, await decryptBackup(encrypted, password));
    validateBackupFile(restoredPath, owner.organizationId);
  } finally {
    if (previous === undefined) delete process.env.ABDO_RESTORE_ROOT; else process.env.ABDO_RESTORE_ROOT = previous;
    db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('TOTP follows RFC 6238 SHA1 vectors and base32 encodes keys', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  for (const [time, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const)
    assert.equal(totp(secret, Math.floor(time / 30), 8), expected);
});

function decodeSecret(secret: string) {
  let value = 0, bits = 0; const bytes: number[] = [];
  for (const letter of secret) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

test('MFA enrollment is session-bound, encrypts secrets, revokes other sessions and prevents replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'abdo-mfa-test-')), previous = process.env.ABDO_SECURITY_KEY_FILE;
  const db = openDatabase(':memory:');
  process.env.ABDO_SECURITY_KEY_FILE = join(root, 'key'); writeFileSync(process.env.ABDO_SECURITY_KEY_FILE, randomBytes(32).toString('hex'));
  try {
    const user = fixtureAdmin(db); createSession(db, user.id, '1', 1);
    const enrollment = beginMfa(db, user.id, user.username, 'current');
    assert.equal(hasMfa(db, user.id), false);
    const code = totp(decodeSecret(enrollment.secret), Math.floor(Date.now() / 30_000));
    assert.equal(confirmMfa(db, user.id, 'other', code), null);
    const recovery = confirmMfa(db, user.id, 'current', code)!;
    assert.equal(recovery.length, 10); assert.equal(hasMfa(db, user.id), true);
    assert.equal(db.prepare('SELECT 1 FROM sessions WHERE revoked_at IS NULL').get(), undefined);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM user_mfa').get()).includes(enrollment.secret), false);
    assert.equal(verifyMfa(db, user.id, code), false);
    assert.equal(verifyMfa(db, user.id, recovery[0]), true);
    assert.equal(verifyMfa(db, user.id, recovery[0]), false);
    const challenge = createMfaChallenge(db, user.id);
    for (let i = 0; i < 5; i++) assert.equal(consumeMfaChallenge(db, challenge, 'invalid'), null);
    assert.equal(consumeMfaChallenge(db, challenge, recovery[1]), null);
    const fresh = createMfaChallenge(db, user.id);
    assert.equal(consumeMfaChallenge(db, fresh, recovery[1]), user.id);
    assert.equal(consumeMfaChallenge(db, fresh, recovery[2]), null);
    const expired = createMfaChallenge(db, user.id);
    db.prepare("UPDATE mfa_challenges SET expires_at='2000-01-01'").run();
    assert.equal(consumeMfaChallenge(db, expired, recovery[2]), null);
  } finally {
    db.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ABDO_SECURITY_KEY_FILE; else process.env.ABDO_SECURITY_KEY_FILE = previous;
  }
});

test('realtime streams reject excess connections before headers and release capacity on close', () => {
  const db = openDatabase(':memory:'), user = fixtureAdmin(db), hub = new EventHub(db);
  const session = createSession(db, user.id, '1', 1);
  const viewer = { userId: user.id, sessionTokenHash: db.prepare('SELECT token_hash FROM sessions').get()!.token_hash as string };
  assert.ok(session.token);
  class Response extends EventEmitter {
    headersSent = false; writableLength = 0; writableEnded = false; destroyed = false;
    setHeader() {} writeHead() { this.headersSent = true; } write() {} end() { this.writableEnded = true; this.emit('close'); } destroy() { this.destroyed = true; this.emit('close'); }
  }
  try {
    const responses = Array.from({ length: MAX_EVENT_STREAMS_PER_USER }, () => new Response());
    responses.forEach(response => assert.equal(hub.attach(response as unknown as ServerResponse, 0, viewer), true));
    const extra = new Response();
    assert.throws(() => hub.attach(extra as unknown as ServerResponse, 0, viewer), { code: 'EVENT_STREAM_LIMIT' });
    assert.equal(extra.headersSent, false);
    responses[0].end();
    assert.equal(hub.attach(extra as unknown as ServerResponse, 0, viewer), true);
  } finally { hub.close(); db.close(); }
});

test('HTTP MFA flow never issues a session until second factor and enforces CSRF and replay protection', async () => {
  const db = openDatabase(':memory:'), root = mkdtempSync(join(tmpdir(), 'abdo-mfa-http-')), previous = process.env.ABDO_SECURITY_KEY_FILE;
  process.env.ABDO_SECURITY_KEY_FILE = join(root, 'key'); writeFileSync(process.env.ABDO_SECURITY_KEY_FILE, randomBytes(32).toString('hex'));
  const server = createApp(db, loadConfig({ internetRequired: false, publicOrigin: '', secureCookie: false }));
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-api-version': '1', ...headers }, body: JSON.stringify(body) });
  try {
    await post('/api/setup/admin', { username: 'admin', displayName: 'Test administrator', password: 'Test Admin 12345!' });
    const initial = await post('/api/auth/login', { username: 'admin', password: 'Test Admin 12345!' });
    const cookie = initial.headers.getSetCookie()[0].split(';')[0], initialBody = await initial.json();
    const headers = { cookie, 'x-csrf-token': initialBody.data.csrfToken };
    assert.equal((await post('/api/auth/mfa/begin', { password: 'Test Admin 12345!' }, { cookie })).status, 403);
    const begin = await post('/api/auth/mfa/begin', { password: 'Test Admin 12345!' }, headers);
    assert.equal(begin.status, 200);
    const enrollment = (await begin.json()).data;
    const code = totp(decodeSecret(enrollment.secret), Math.floor(Date.now() / 30_000));
    const confirmed = await post('/api/auth/mfa/confirm', { code }, headers);
    assert.equal(confirmed.status, 200);
    const recovery = (await confirmed.json()).data.recoveryCodes;
    const login = await post('/api/auth/login', { username: 'admin', password: 'Test Admin 12345!' });
    assert.equal(login.status, 401); assert.equal((await login.json()).error.code, 'MFA_REQUIRED');
    const challengeCookie = login.headers.getSetCookie()[0].split(';')[0];
    assert.equal(challengeCookie.startsWith('abdo_mfa='), true);
    assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: challengeCookie } })).status, 401);
    assert.equal((await post('/api/auth/mfa/verify', { code: 'invalid' }, { cookie: challengeCookie })).status, 401);
    const verified = await post('/api/auth/mfa/verify', { code: recovery[0] }, { cookie: challengeCookie });
    assert.equal(verified.status, 200);
    assert.equal(verified.headers.getSetCookie().some(value => value.startsWith('abdo_session=')), true);
    assert.equal((await post('/api/auth/mfa/verify', { code: recovery[1] }, { cookie: challengeCookie })).status, 401);
  } finally {
    server.closeRealtimeConnections(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    db.close(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.ABDO_SECURITY_KEY_FILE; else process.env.ABDO_SECURITY_KEY_FILE = previous;
  }
});
