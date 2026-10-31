import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig, API_VERSION } from '../src/server/config.ts';

const { db, admin } = accountCardFixture(3);
const balances = db.prepare('SELECT id,current_balance_units FROM customers ORDER BY id').all();
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
const browser = await chromium.launch();
const errors: string[] = [];
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const session = createSession(db, admin.id, API_VERSION, 12);
  await context.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  await context.addInitScript(() => {
    const voices = [
      {
        name: 'صوت مصري للاختبار الآلي فقط',
        lang: 'ar-EG',
        voiceURI: 'egypt-test',
        default: false,
        localService: true,
      },
    ];
    const state = window as unknown as {
      spoken: { text: string; lang: string; rate: number }[];
      testVoices: unknown[];
    };
    state.spoken = [];
    state.testVoices = [];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        voice: unknown = null;
        lang = '';
        rate = 1;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(speechSynthesis, 'getVoices', { value: () => state.testVoices });
    Object.defineProperty(speechSynthesis, 'speak', {
      value: (u: SpeechSynthesisUtterance) => state.spoken.push({ text: u.text, lang: u.lang, rate: u.rate }),
    });
    // Deliberately empty initially; voices can arrive after the account settings.
    window.addEventListener('test-voices-ready', () => {
      state.testVoices = voices;
      speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  await expect(page.getByLabel('طريقة النطق', { exact: true })).toBeEnabled();
  await page.getByLabel('طريقة النطق', { exact: true }).selectOption('clear');
  const currentPreview = page.getByRole('button', { name: 'تجربة وضوح النطق الحالي', exact: true });
  await expect(currentPreview).toBeEnabled();
  await currentPreview.click();
  const currentSpeech = await page.evaluate(() => (window as unknown as { spoken: { text: string; lang: string; rate: number }[] }).spoken);
  assert.equal(currentSpeech.map(part => part.text).join(' '), 'هذه تجربة وضوح النطق بالصوت الحالي. الموظف أحمد سجّل تسديدًا جزئيًا للعميل محمد بقيمة 1500 دينار ليبي. وسجّل استهلاك فودافون بقيمة 250 جنيه مصري. هذه بيانات تجريبية فقط.');
  assert.ok(currentSpeech.every(part => part.lang === 'ar-LY' && part.rate === .95));
  await page.evaluate(() => { (window as unknown as { spoken: unknown[] }).spoken = []; });
  await page.getByLabel('طريقة النطق', { exact: true }).selectOption('egyptian');
  await expect(page.getByText(/لا يتوفر صوت مصري/)).toBeVisible();
  const preview = page.getByRole('button', { name: 'تجربة الصوت المصري', exact: true });
  await expect(preview).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('test-voices-ready')));
  await expect(preview).toBeEnabled();
  await page.getByLabel('سرعة القراءة', { exact: true }).selectOption('0.9');
  await expect(preview).toBeEnabled();
  // Synthetic inventory tests selection only; real audio is verified separately.
  await page.getByLabel('الصوت المصري', { exact: true }).selectOption('egypt-test');
  await expect(preview).toBeEnabled();
  await preview.click();
  assert.deepEqual(await page.evaluate(() => (window as unknown as { spoken: unknown[] }).spoken), [
    {
      text: 'أهلًا بيك. دي تجربة صوت الإشعارات المصري. تم تسجيل تسديد بقيمة 150 دينار ليبي.',
      lang: 'ar-EG',
      rate: 0.9,
    },
  ]);
  await expect
    .poll(async () => (await context.request.get(base + '/api/notification-speech')).json())
    .toMatchObject({ data: { profile: 'egyptian', voiceURI: 'egypt-test', rate: 0.9 } });
  await page.reload();
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  await expect(page.getByLabel('طريقة النطق', { exact: true })).toHaveValue('egyptian');
  await expect(page.getByText(/لا يتوفر صوت مصري/)).toBeVisible();
  const anotherDevice = await browser.newContext();
  const anotherSession = createSession(db, admin.id, API_VERSION, 12);
  await anotherDevice.addCookies([
    { name: 'abdo_session', value: anotherSession.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  assert.deepEqual((await (await anotherDevice.request.get(base + '/api/notification-speech')).json()).data, {
    profile: 'egyptian',
    voiceURI: 'egypt-test',
    rate: 0.9,
  });
  await anotherDevice.close();
  await page.route('**/api/notification-speech', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'TEST_SAVE_FAILED', message: 'Test failure' } }),
      });
    else await route.continue();
  });
  await page.getByLabel('طريقة النطق', { exact: true }).selectOption('default');
  await expect(
    page.getByText('لم يتم حفظ إعدادات الصوت. الإعداد السابق ما زال مستخدمًا.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('طريقة النطق', { exact: true })).toHaveValue('egyptian');
  await page.unroute('**/api/notification-speech');
  await page.reload();
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await page.getByText('صوت الإشعارات لحسابي', { exact: true }).click();
  mkdirSync('artifacts/notification-speech', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(preview).toBeVisible();
      assert.ok(
        await page.locator('.notification-panel').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        }),
      );
      await page.screenshot({ path: `artifacts/notification-speech/${theme}-${width}.png` });
    }
  }
  db.prepare(
    `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
    SELECT 'speech-employee','speech-employee','Employee',password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`,
  ).run(admin.id);
  db.prepare(
    "INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('speech-employee','collections.read',1,?)",
  ).run(new Date().toISOString());
  const employee = await browser.newContext();
  const employeeSession = createSession(db, 'speech-employee', API_VERSION, 12);
  await employee.addCookies([
    { name: 'abdo_session', value: employeeSession.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  assert.equal((await employee.request.get(base + '/api/notification-speech')).status(), 403);
  assert.equal(
    (
      await employee.request.patch(base + '/api/notification-speech', {
        headers: { 'X-CSRF-Token': employeeSession.csrfToken, 'X-Client-Api-Version': API_VERSION },
        data: { profile: 'egyptian', voiceURI: '', rate: 1 },
      })
    ).status(),
    403,
  );
  const employeePage = await employee.newPage();
  await employeePage.goto(base + '/erp');
  await employeePage.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await expect(employeePage.locator('.admin-notification-speech')).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert.deepEqual(db.prepare('SELECT id,current_balance_units FROM customers ORDER BY id').all(), balances);
  console.log(
    'PASS account speech: delayed/missing Egyptian voices, persisted account settings, reload, phone/desktop in both themes, employee API/UI blocked. Browser voice inventory is simulated; actual sound requires listening on the target device.',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
