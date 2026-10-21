import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

export const MAX_ENCRYPTED_BACKUP_BYTES = 49 * 1024 * 1024;
export type EncryptedBackup = {
  format: 'abdo-erp-encrypted-backup'; version: 1; createdAt: string;
  cipher: 'aes-256-gcm'; kdf: 'scrypt'; salt: string; iv: string; tag: string; ciphertext: string;
};
const aad = Buffer.from('abdo-erp-encrypted-backup:1');
let activeDerivations = 0;
async function keyFor(password: string, salt: Buffer) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    throw new Error('اختر كلمة تشفير بين 12 و256 حرفًا.');
  if (activeDerivations >= 2) throw new Error('توجد عملية تشفير أخرى. أعد المحاولة بعد قليل.');
  activeDerivations++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key)));
  } finally { activeDerivations--; }
}
function bytes(value: unknown, length?: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('ملف التشفير غير صالح.');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (length !== undefined && decoded.length !== length))
    throw new Error('ملف التشفير غير صالح.');
  return decoded;
}
export async function encryptBackup(plaintext: Uint8Array, password: string): Promise<EncryptedBackup> {
  if (plaintext.length > MAX_ENCRYPTED_BACKUP_BYTES) throw new Error('حجم النسخة يتجاوز الحد المسموح.');
  const salt = randomBytes(32), iv = randomBytes(12);
  const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { format: 'abdo-erp-encrypted-backup', version: 1, createdAt: new Date().toISOString(),
      cipher: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') };
  } finally { key.fill(0); }
}
export async function decryptBackup(value: Record<string, unknown>, password: string) {
  if (value.format !== 'abdo-erp-encrypted-backup' || value.version !== 1 || value.cipher !== 'aes-256-gcm' || value.kdf !== 'scrypt'
    || typeof value.ciphertext !== 'string' || value.ciphertext.length > Math.ceil(MAX_ENCRYPTED_BACKUP_BYTES / 3) * 4)
    throw new Error('ملف التشفير غير صالح.');
  const salt = bytes(value.salt, 32), iv = bytes(value.iv, 12), tag = bytes(value.tag, 16);
  const encrypted = bytes(value.ciphertext);
  const key = await keyFor(password, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch { throw new Error('كلمة التشفير غير صحيحة أو النسخة معدّلة أو تالفة.'); }
  finally { key.fill(0); }
}
