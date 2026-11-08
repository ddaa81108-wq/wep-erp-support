import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const db = openDatabase(':memory:'), admin = fixtureAdmin(db);
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  await context.addInitScript(() => {
    const state = window as unknown as {
      speechTest: { mode: string; spoken: { text: string; lang: string }[]; cancelled: number; resumed: number };
    };
    state.speechTest = { mode: 'not-allowed', spoken: [], cancelled: 0, resumed: 0 };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class {
      text: string; lang = ''; rate = 1; voice: unknown;
      onerror?: (event: { error: string }) => void; onstart?: () => void; onend?: () => void;
      constructor(text: string) { this.text = text; }
    } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'صوت عربي اختباري', lang: 'ar-SA', voiceURI: 'test-ar', default: true }],
      addEventListener() {}, removeEventListener() {},
      cancel() { state.speechTest.cancelled++; }, resume() { state.speechTest.resumed++; },
      speak(u: { text: string; lang: string; onerror?: (event: { error: string }) => void; onstart?: () => void; onend?: () => void }) {
        state.speechTest.spoken.push({ text: u.text, lang: u.lang });
        window.setTimeout(() => {
          if (state.speechTest.mode === 'ok') { u.onstart?.(); u.onend?.(); }
          else if (state.speechTest.mode !== 'silent') u.onerror?.({ error: state.speechTest.mode });
        }, 0);
      },
    } });
  });
  const page = await context.newPage();
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  const panel = page.locator('.admin-notification-speech');
  const test = panel.getByRole('button', { name: 'تجربة وضوح النطق الحالي', exact: true });
  await expect(page.getByLabel('طريقة النطق', { exact: true })).toHaveValue('default');
  await expect(test).toBeEnabled();
  await test.click();
  await expect(panel.locator('[data-speech-error="not-allowed"]')).toContainText('المتصفح منع تشغيل النطق');
  const readState = () => page.evaluate(() => (window as unknown as { speechTest: { spoken: { text: string; lang: string }[]; cancelled: number; resumed: number; mode: string } }).speechTest);
  const failed = await readState();
  assert.ok(failed.spoken.length > 0);
  assert.equal(failed.cancelled, 0, 'Normal tests and notices never cancel an existing queue');
  assert.ok(failed.spoken.every(part => part.lang === 'ar-SA'));
  await page.evaluate(() => { (window as unknown as { speechTest: { mode: string } }).speechTest.mode = 'ok'; });
  await panel.getByRole('button', { name: 'إعادة تهيئة الصوت وتجربته', exact: true }).click();
  await expect(panel.locator('[data-speech-phase="finished"]')).toBeVisible();
  const recovered = await readState();
  assert.equal(recovered.cancelled, 1); assert.equal(recovered.resumed, 1);
  assert.equal(recovered.spoken.length, failed.spoken.length * 2, 'Only the explicitly requested new preview is queued');
  await page.evaluate(() => { (window as unknown as { speechTest: { mode: string } }).speechTest.mode = 'language-unavailable'; });
  await test.click();
  await expect(panel.locator('[data-speech-error="language-unavailable"]')).toContainText('لا يتوفر صوت مناسب');
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  await expect(page.locator('.notification-panel > [role="alert"]')).toContainText('لا يتوفر صوت مناسب');
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  mkdirSync('artifacts/speech-diagnostics', { recursive: true });
  await page.screenshot({ path: 'artifacts/speech-diagnostics/desktop-error.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: 'إعادة تهيئة الصوت وتجربته', exact: true })).toBeEnabled();
  assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: 'artifacts/speech-diagnostics/phone-error.png' });
  assert.deepEqual(writes, [], 'Speech test/reset does not change settings, preferences or financial data');
  assert.deepEqual(errors, []);
  console.log('PASS: asynchronous blocked/missing-language errors visible, explicit reset/recovery, default profile test, available Arabic voice, phone fit, zero API writes. Audio events are simulated; audibility requires the target device.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done())); db.close();
}
