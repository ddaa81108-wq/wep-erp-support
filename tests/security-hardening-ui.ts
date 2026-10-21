import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { openDatabase } from '../src/server/db/database.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { totp } from '../src/server/security/mfa.ts';
import { decryptBackup } from '../src/server/security/backupEncryption.ts';

const root = mkdtempSync(join(tmpdir(), 'abdo-security-ui-')), previous = process.env.ABDO_SECURITY_KEY_FILE;
process.env.ABDO_SECURITY_KEY_FILE = join(root, 'key'); writeFileSync(process.env.ABDO_SECURITY_KEY_FILE, randomBytes(32).toString('hex'));
const db = openDatabase(join(root, 'test.sqlite'));
const server = createApp(db, loadConfig({ publicOrigin: '', secureCookie: false, internetRequired: false }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  assert.ok((await page.request.post(`${base}/api/setup/admin`, { data: { username: 'admin', displayName: 'Security test', password: 'Security UI test 123!' } })).ok());
  await page.goto(`${base}/erp`);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Security UI test 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
  await page.getByRole('button', { name: /مركز التشغيل والأمان/ }).click();
  await page.getByLabel('كلمة مرور حسابك الحالية').fill('Security UI test 123!');
  await page.getByRole('button', { name: 'ربط تطبيق المصادقة', exact: true }).click();
  const codeElement = page.locator('[aria-label="حماية حسابي"] code');
  await expect(codeElement).toBeVisible();
  const encoded = (await codeElement.textContent())!;
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const letter of encoded) { value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); } }
  await page.getByLabel('رمز التطبيق أو الاسترداد').fill(totp(Buffer.from(bytes), Math.floor(Date.now() / 30_000)));
  await page.getByRole('button', { name: 'تأكيد التفعيل', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تنزيل رموز الاسترداد', exact: true })).toBeVisible();
  const recovery = (await page.locator('[aria-label="حماية حسابي"] pre').textContent())!.split('\n');
  await page.getByRole('button', { name: 'العودة إلى الإعدادات', exact: true }).click();
  await page.getByRole('button', { name: /النسخ الاحتياطي والاستعادة/ }).click();
  const password = 'Encrypted UI backup 12345';
  await page.getByLabel('كلمة تشفير النسخة (12 حرفًا على الأقل)').fill(password);
  await page.getByLabel('تأكيد كلمة التشفير', { exact: true }).fill(password);
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل نسخة طارئة مشفّرة', exact: true }).click();
  const download = await downloadWait, downloadPath = join(root, 'test.abdobackup'); await download.saveAs(downloadPath);
  const encrypted = JSON.parse(readFileSync(downloadPath, 'utf8'));
  const restored = await decryptBackup(encrypted, password);
  assert.equal(restored.subarray(0, 15).toString(), 'SQLite format 3');
  const output = resolve('artifacts/security-hardening'); mkdirSync(output, { recursive: true });
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: join(output, `encrypted-backup-${width}.png`), fullPage: true });
  }
  const second = await browser.newPage({ viewport: { width: 390, height: 844 } }); second.on('pageerror', error => errors.push(error.message));
  await second.goto(`${base}/erp`);
  await second.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await second.getByLabel('كلمة المرور', { exact: true }).fill('Security UI test 123!');
  await second.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'التحقق بخطوتين', exact: true })).toBeVisible();
  await second.screenshot({ path: join(output, 'mfa-login-mobile.png'), fullPage: true });
  await second.getByLabel('رمز التحقق', { exact: true }).fill(recovery[0]);
  await second.getByRole('button', { name: 'تأكيد الدخول', exact: true }).click();
  await expect(second.locator('.app-shell')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: real enrollment, recovery-code login, encrypted backup download and decrypt, desktop/mobile layout, no browser errors.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  db.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ABDO_SECURITY_KEY_FILE; else process.env.ABDO_SECURITY_KEY_FILE = previous;
}
