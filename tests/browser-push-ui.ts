import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import webPush from 'web-push';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';
const dir = mkdtempSync(join(tmpdir(), 'browser-push-ui-'));
const db = openDatabase(join(dir, 'test.sqlite'));
const vapid = webPush.generateVAPIDKeys();
const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  sessionHours: 12,
  secureCookie: false,
  internetRequired: false,
  internetProbeUrls: [],
  internetProbeTimeoutMs: 100,
  internetProbeCacheMs: 100,
  pushPublicKey: vapid.publicKey,
  pushPrivateKey: vapid.privateKey,
  pushSubject: 'https://vip2100.com',
};
let delivered = 0;
const server = createApp(db, config, {
  pushSend: async () => {
    delivered++;
  },
});
const browser = await chromium.launch();
const output = resolve('artifacts/browser-push');
mkdirSync(output, { recursive: true });
try {
  await listen(server, config.host, 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'مدير الاختبار', password: 'Browser Push 123!' },
  });
  await context.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Browser Push 123!' },
  });
  // Verify a real registration and its scope independently of the mocked push provider below.
  const workerPage = await context.newPage();
  await workerPage.goto(base + '/erp');
  const scope = await workerPage.evaluate(async () => {
    await navigator.serviceWorker.register('/erp-push-sw.js', { scope: '/' });
    return (await navigator.serviceWorker.ready).scope;
  });
  assert.equal(scope, base + '/');
  await workerPage.close();
  const key = createECDH('prime256v1');
  key.generateKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-ui',
    keys: { p256dh: key.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  await context.addInitScript(
    ({ subscription, publicKey }) => {
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      );
      const fake = {
        endpoint: subscription.endpoint,
        options: { applicationServerKey: bytes.buffer },
        toJSON: () => subscription,
        unsubscribe: async () => {
          localStorage.removeItem('test-push-subscribed');
          return true;
        },
      };
      const registration = {
        pushManager: {
          getSubscription: async () => (localStorage.getItem('test-push-subscribed') ? fake : null),
          subscribe: async () => {
            localStorage.setItem('test-push-subscribed', 'yes');
            return fake;
          },
        },
      };
      Object.defineProperty(Notification, 'permission', {
        get: () => localStorage.getItem('test-push-permission') ?? 'default',
      });
      Notification.requestPermission = async () => {
        const value = localStorage.getItem('test-push-deny') ? 'denied' : 'granted';
        localStorage.setItem('test-push-permission', value);
        return value;
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      });
    },
    { subscription, publicKey: vapid.publicKey },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  const toggle = page.locator('.browser-push-toggle');
  await expect(toggle).toBeEnabled();
  await page.evaluate(() => localStorage.setItem('test-push-deny', 'yes'));
  await toggle.click();
  await expect(page.locator('.browser-push-controls')).toContainText('الإشعارات محظورة');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 0);
  await page.evaluate(() => localStorage.removeItem('test-push-deny'));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 1);
  await page.getByRole('button', { name: 'إرسال إشعار تجريبي', exact: true }).click();
  await expect(page.locator('.browser-push-controls')).toContainText('لا يؤكد وصوله');
  await expect.poll(() => delivered, { timeout: 7000 }).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
      await page
        .getByRole('button', { name: theme === 'dark' ? 'المظهر الليلي' : 'المظهر النهاري', exact: true })
        .click();
    await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 390)
        await expect
          .poll(() =>
            page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().left >= innerWidth),
          )
          .toBe(true);
      await expect(toggle).toBeVisible();
      assert.ok(
        await toggle.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return b.left >= 0 && b.right <= innerWidth;
        }),
      );
      await page.screenshot({ path: join(output, theme + '-' + width + '.png') });
    }
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: actual service-worker registration, permission denial, mocked browser push subscription with real API, test dispatch, persistence, disable, themes and viewports. No real push provider delivery claimed.',
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
