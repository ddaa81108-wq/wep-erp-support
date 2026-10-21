import {
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { conflict } from '../http/errors.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(secret: Buffer) {
  let bits = 0,
    value = 0,
    output = '';
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
export function totp(secret: Buffer, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
function key() {
  const path = process.env.ABDO_SECURITY_KEY_FILE;
  if (!path) throw conflict('MFA_NOT_CONFIGURED', 'لم تتم تهيئة مفتاح حماية المصادقة على الخادم.');
  const raw = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error('Invalid security key file.');
  return Buffer.from(raw, 'hex');
}
export function mfaConfigured() {
  try {
    const value = key();
    value.fill(0);
    return true;
  } catch {
    return false;
  }
}
function seal(secret: Buffer, userId: string) {
  const value = key(),
    iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', value, iv);
    cipher.setAAD(Buffer.from(userId));
    const bytes = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  } finally {
    value.fill(0);
  }
}
function unseal(secret: string, userId: string) {
  const value = key(),
    bytes = Buffer.from(secret, 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', value, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  } finally {
    value.fill(0);
  }
}
export function hasMfa(db: AppDatabase, userId: string) {
  return Boolean(db.prepare('SELECT 1 FROM user_mfa WHERE user_id=? AND secret IS NOT NULL').get(userId));
}
export function beginMfa(db: AppDatabase, userId: string, username: string, session: string) {
  if (hasMfa(db, userId)) throw conflict('MFA_ALREADY_ENABLED', 'التحقق بخطوتين مفعّل بالفعل.');
  const secret = randomBytes(20),
    expires = new Date(Date.now() + 600_000).toISOString();
  db.prepare(
    `INSERT INTO user_mfa(user_id,pending_secret,pending_session,pending_expires_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_session=excluded.pending_session,pending_expires_at=excluded.pending_expires_at`,
  ).run(userId, seal(secret, userId), session, expires);
  const encoded = base32(secret);
  secret.fill(0);
  return {
    secret: encoded,
    uri: `otpauth://totp/${encodeURIComponent(`Abdo ERP:${username}`)}?secret=${encoded}&issuer=Abdo%20ERP&algorithm=SHA1&digits=6&period=30`,
  };
}
function matchingStep(secret: Buffer, code: string, lastStep: number) {
  if (!/^\d{6}$/.test(code)) return -1;
  const step = Math.floor(Date.now() / 30_000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate > lastStep && timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, candidate))))
      return candidate;
  }
  return -1;
}
export function confirmMfa(db: AppDatabase, userId: string, session: string, code: string) {
  return inImmediateTransaction(db, () => {
    const row = db.prepare('SELECT * FROM user_mfa WHERE user_id=? AND secret IS NULL').get(userId);
    if (!row?.pending_secret || row.pending_session !== session || String(row.pending_expires_at) <= nowIso())
      return null;
    const secret = unseal(String(row.pending_secret), userId);
    let step: number;
    try {
      step = matchingStep(secret, code, -1);
    } finally {
      secret.fill(0);
    }
    if (step < 0) return null;
    const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex'));
    db.prepare(
      `UPDATE user_mfa SET secret=pending_secret,pending_secret=NULL,pending_session=NULL,pending_expires_at=NULL,last_step=?,recovery_hashes=? WHERE user_id=?`,
    ).run(step, JSON.stringify(codes.map(digest)), userId);
    db.prepare(
      'UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL',
    ).run(nowIso(), userId, session);
    db.prepare('DELETE FROM mfa_challenges WHERE user_id=?').run(userId);
    return codes;
  });
}
export function verifyMfa(db: AppDatabase, userId: string, code: string) {
  return inImmediateTransaction(db, () => {
    const row = db.prepare('SELECT * FROM user_mfa WHERE user_id=? AND secret IS NOT NULL').get(userId);
    if (!row) return false;
    const secret = unseal(String(row.secret), userId);
    let step: number;
    try {
      step = matchingStep(secret, code, Number(row.last_step));
    } finally {
      secret.fill(0);
    }
    if (step >= 0) {
      db.prepare('UPDATE user_mfa SET last_step=? WHERE user_id=?').run(step, userId);
      return true;
    }
    const hashes = JSON.parse(String(row.recovery_hashes)) as string[];
    const hash = digest(code);
    if (!/^[a-f0-9]{20}$/.test(code) || !hashes.includes(hash)) return false;
    db.prepare('UPDATE user_mfa SET recovery_hashes=? WHERE user_id=?').run(
      JSON.stringify(hashes.filter((item) => item !== hash)),
      userId,
    );
    return true;
  });
}
export function createMfaChallenge(db: AppDatabase, userId: string) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM mfa_challenges WHERE expires_at<=? OR user_id=?').run(nowIso(), userId);
  db.prepare('INSERT INTO mfa_challenges(token_hash,user_id,expires_at) VALUES(?,?,?)').run(
    digest(token),
    userId,
    new Date(Date.now() + 300_000).toISOString(),
  );
  return token;
}
export function consumeMfaChallenge(db: AppDatabase, token: string, code: string) {
  return inImmediateTransaction(db, () => {
    const hash = digest(token);
    const row = db
      .prepare('SELECT * FROM mfa_challenges WHERE token_hash=? AND expires_at>? AND attempts<5')
      .get(hash, nowIso());
    if (!row) return null;
    db.prepare('UPDATE mfa_challenges SET attempts=attempts+1 WHERE token_hash=?').run(hash);
    if (!verifyMfa(db, String(row.user_id), code)) return null;
    db.prepare('DELETE FROM mfa_challenges WHERE token_hash=?').run(hash);
    return String(row.user_id);
  });
}
