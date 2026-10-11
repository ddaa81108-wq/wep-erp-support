import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';
import { openDatabase, type AppDatabase } from '../db/database.ts';
import { SCHEMA_VERSION } from '../config.ts';
import { badRequest, conflict, forbidden } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

export const MAX_BACKUP_BYTES = 48 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function restoreStatus() {
  const root = process.env.ABDO_RESTORE_ROOT;
  if (!root) return null;
  if (existsSync(join(root, 'processing.json'))) return { state: 'running', completedAt: null };
  if (existsSync(join(root, 'pending.json'))) return { state: 'queued', completedAt: null };
  try {
    const result = JSON.parse(readFileSync(join(root, 'last-result.json'), 'utf8'));
    return { state: result.success ? 'succeeded' : 'failed', completedAt: String(result.completedAt) };
  } catch { return { state: 'idle', completedAt: null }; }
}
export function requireBackupOwner(db: AppDatabase, user: AuthenticatedUser) {
  if (!user.isOwner || user.role !== 'admin') throw forbidden('backup.owner');
  const organizations = db.prepare('SELECT id FROM organizations').all();
  if (organizations.length !== 1 || organizations[0].id !== user.organizationId)
    throw forbidden('backup.single-organization');
}
export function validateBackupFile(path: string, organizationId: string) {
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    if (Object.values(copy.prepare('PRAGMA quick_check').get()!)[0] !== 'ok' || copy.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('integrity');
    const version = copy.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version;
    if (Number(version) !== Number(SCHEMA_VERSION)) throw new Error('version');
    const organizations = copy.prepare('SELECT id FROM organizations').all();
    if (organizations.length !== 1 || organizations[0].id !== organizationId) throw new Error('organization');
  } finally { copy.close(); }
  // Also validate migration names and checksums against this application.
  const checked = openDatabase(path);
  checked.close();
}
export async function createEmergencyBackup(db: AppDatabase, user: AuthenticatedUser) {
  requireBackupOwner(db, user);
  const directory = mkdtempSync(join(tmpdir(), 'abdo-emergency-'));
  const path = join(directory, 'database.sqlite');
  try {
    await backup(db, path);
    validateBackupFile(path, user.organizationId);
    const bytes = readFileSync(path);
    if (bytes.length > MAX_BACKUP_BYTES) throw badRequest('BACKUP_TOO_LARGE', 'حجم النسخة يتجاوز حد التنزيل من الصفحة (48 ميجابايت).');
    return { format: 'abdo-erp-backup', version: 1, createdAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION,
      organizationId: user.organizationId, size: bytes.length, sha256: hash(bytes), database: bytes.toString('base64') };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function stageRestore(db: AppDatabase, user: AuthenticatedUser, body: Record<string, unknown>) {
  requireBackupOwner(db, user);
  if (process.platform !== 'win32' || !process.env.ABDO_RESTORE_ROOT) throw conflict('RESTORE_NOT_CONFIGURED', 'خدمة الاستعادة غير مهيأة على هذا الخادم.');
  if (body.confirmation !== 'استعادة') throw badRequest('RESTORE_CONFIRMATION', 'اكتب استعادة لتأكيد استبدال البيانات الحالية.');
  const value = body.backup as Record<string, unknown> | undefined;
  if (!value || value.format !== 'abdo-erp-backup' || value.version !== 1 || typeof value.database !== 'string' || value.database.length > MAX_BACKUP_BYTES * 1.34)
    throw badRequest('INVALID_BACKUP', 'ملف النسخة الاحتياطية غير صالح.');
  const bytes = Buffer.from(value.database, 'base64');
  if (bytes.length > MAX_BACKUP_BYTES || bytes.length !== value.size || hash(bytes) !== value.sha256 || (value.organizationId !== undefined && value.organizationId !== user.organizationId))
    throw badRequest('INVALID_BACKUP', 'فشل فحص حجم النسخة أو بصمتها أو المؤسسة التابعة لها.');
  const root = process.env.ABDO_RESTORE_ROOT;
  mkdirSync(root, { recursive: true });
  if (existsSync(join(root, 'pending.json')) || existsSync(join(root, 'processing.json')))
    throw conflict('RESTORE_PENDING', 'توجد استعادة قيد التنفيذ بالفعل.');
  const directory = mkdtempSync(join(root, 'restore-'));
  const path = join(directory, 'database.sqlite');
  try {
    writeFileSync(path, bytes, { flag: 'wx' });
    validateBackupFile(path, user.organizationId);
    const checkedBytes = readFileSync(path);
    writeFileSync(`${path}.json`, JSON.stringify({ manifestVersion: 1, file: 'database.sqlite', fileSizeBytes: checkedBytes.length,
      schemaVersion: Number(SCHEMA_VERSION), sha256: hash(checkedBytes) }), { flag: 'wx' });
    writeFileSync(join(root, 'pending.tmp'), JSON.stringify({ path, sha256: hash(checkedBytes), organizationId: user.organizationId, requestedAt: new Date().toISOString() }), { flag: 'wx' });
    renameSync(join(root, 'pending.tmp'), join(root, 'pending.json'));
    return { queued: true, message: 'تم فحص النسخة. ستبدأ الاستعادة خلال دقيقة، مع إنشاء نسخة إنقاذ وإعادة تشغيل الخادم. سجّل الدخول مجددًا بعد اكتمالها.' };
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw badRequest('RESTORE_VALIDATION_FAILED', 'النسخة تالفة أو لا تطابق إصدار التطبيق أو المؤسسة الحالية. لم تتغير البيانات الحية.');
  }
}
