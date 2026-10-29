import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

type Stage = {
  requests: number;
  down: number;
  requestMetadata: number;
  streams: number;
  streamDecoded: number;
  notification200: number;
  notification304: number;
  searchCalls: number;
  compactRows: number[];
};
const empty = (): Stage => ({
  requests: 0,
  down: 0,
  requestMetadata: 0,
  streams: 0,
  streamDecoded: 0,
  notification200: 0,
  notification304: 0,
  searchCalls: 0,
  compactRows: [],
});
const browser = await chromium.launch();
const output = 'artifacts/network-efficiency';
mkdirSync(output, { recursive: true });
async function measure(label: string, factory: typeof createApp) {
  const { db, admin, accounts } = accountCardFixture();
  const target = accounts.find((item) => item.section === 'customers' && item.balance > 0)!;
  const stamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES('network-staff','network-staff','موظف الاختبار','test','employee','org-default','branch-main',?,?)",
  ).run(stamp, stamp);
  for (const permission of ['debts.read', 'debts.write'])
    db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(
      'network-staff',
      permission,
      stamp,
    );
  for (let i = 0; i < 700; i++)
    db.prepare(
      "INSERT INTO event_log(topic,organization_id,aggregate_id,payload_json,created_at) VALUES('customer.changed','org-default',?,'{}',?)",
    ).run(target.id, stamp);
  for (let i = 0; i < 15; i++)
    db.prepare(
      "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES('org-default',?,'network-staff','customer.create','customer',?,'{}',?)",
    ).run(admin.id, target.id, stamp);
  const server = factory(
    db,
    loadConfig({ databasePath: ':memory:', internetRequired: false, secureCookie: false, publicOrigin: '' }),
  );
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const session = createSession(db, admin.id, '1', 1);
  await context.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const staff = createSession(db, 'network-staff', '1', 1);
  const writer = await browser.newContext();
  await writer.addCookies([
    { name: 'abdo_session', value: staff.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const result: { name: string; stages: Record<string, Stage>; saveToVisibleMs?: number;saveSamplesMs?:number[];saveMedianMs?:number; errors: string[] } =
    { name: label, stages: {}, errors: [] };
  let stage = 'open';
  result.stages[stage] = empty();
  const current = () => result.stages[stage];
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracking = new Map<string, { stage: string; path: string }>();
  const pendingBodies: Promise<void>[] = [];
  cdp.on('Network.requestWillBeSent', (event) => {
    if (!event.request.url.startsWith(base)) return;
    const path = new URL(event.request.url).pathname;
    tracking.set(event.requestId, { stage, path });
    const stats = current();
    stats.requests++;
    stats.requestMetadata += Buffer.byteLength(event.request.url + JSON.stringify(event.request.headers));
    if (path === '/api/events') stats.streams++;
    if (path === '/api/account-search' || path.endsWith('/suggestions')) stats.searchCalls++;
  });
  cdp.on('Network.loadingFinished', (event) => {
    const item = tracking.get(event.requestId);
    if (item) result.stages[item.stage].down += event.encodedDataLength;
  });
  cdp.on('Network.dataReceived', (event) => {
    const item = tracking.get(event.requestId);
    if (item?.path === '/api/events') result.stages[item.stage].streamDecoded += event.dataLength;
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname === '/api/notifications') {
      if (response.status() === 304) current().notification304++;
      if (response.status() === 200) current().notification200++;
    }
    if (url.pathname === '/api/customers' && url.searchParams.has('known'))
      pendingBodies.push(
        response
          .json()
          .then((body) => {
            current().compactRows.push(body.data.items.length);
          })
          .catch(() => undefined),
      );
  });
  page.on('pageerror', (error) => result.errors.push(error.message));
  function next(value: string) {
    stage = value;
    result.stages[stage] = empty();
  }
  async function save(amount: number, key: string) {
    const row = db.prepare('SELECT version FROM customers WHERE id=?').get(target.id)!;
    const response = await writer.request.post(base + '/api/customers/' + target.id + '/transactions', {
      headers: { origin: base, 'X-CSRF-Token': staff.csrfToken, 'X-Client-Api-Version': '1' },
      data: {
        requestId: key,
        expectedVersion: Number(row.version),
        type: 'debt',
        inputValue: amount,
        calculationMode: 'direct',
        note: key,
      },
    });
    assert.equal(response.status(), 201);
    return (await response.json()).data;
  }
  try {
    await page.goto(base + '/erp');
    await page.locator('.customer-card-main').first().waitFor();
    await page.waitForTimeout(1200);
    for (const [title, ready] of [
      ['قسم ديون الشركات', '.customer-card-main'],
      ['أمانات ليبية', '.customer-card-main'],
      ['قسم المشتريات', '.purchase-action-dock'],
      ['قسم ديون العملاء', '.customer-card-main'],
    ]) {
      await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
      await page.locator(ready).first().waitFor();
      await page.waitForTimeout(350);
    }
    console.log(`MEASURED ${label}: initial and section navigation`);
    next('idle');
    await page.waitForTimeout(16000);
    console.log(`MEASURED ${label}: 16 seconds idle`);
    next('search');
    const search = page.getByRole('textbox', { name: 'البحث الموحد', exact: true });
    for (const term of ['مح', 'محم', 'محمد']) {
      await search.fill(term);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(500);
    await search.fill('');
    assert.equal(current().searchCalls, label === 'after' ? 3 : 12);
    next('remote-save');
    const start = Date.now();
    let saved = await save(17, `network-${label}-save`);
    const card = page
      .locator('.customer-card-main')
      .filter({ has: page.getByText(target.name, { exact: true }) });
    await expect(card.locator('.customer-balance-amount')).toContainText(
      new Intl.NumberFormat('ar-LY').format(saved.balanceUnits),
      { timeout: 3000 },
    );
    result.saveToVisibleMs = Date.now() - start;
    await page.waitForTimeout(500);
    if (label === 'after') {
      assert.equal(result.stages.open.streams, 1, 'All active sections and notifications share one stream');
      assert.ok(result.stages.open.streamDecoded < 1000, 'No historical dump on initial connection');
      assert.ok(result.stages.idle.notification304 >= 3, 'Unchanged notifications use empty responses');
      assert.ok(
        current().compactRows.includes(1),
        'Only the changed account is sent with authoritative order and totals',
      );
    }
    result.saveSamplesMs=[result.saveToVisibleMs];
    for(let index=1;index<5;index++){
      const began=Date.now();saved=await save(17,`network-${label}-sample-${index}`);
      await expect(card.locator('.customer-balance-amount')).toContainText(new Intl.NumberFormat('ar-LY').format(saved.balanceUnits),{timeout:3000});
      result.saveSamplesMs.push(Date.now()-began);await page.waitForTimeout(150);
    }
    result.saveMedianMs=[...result.saveSamplesMs].sort((a,b)=>a-b)[2];
    // Disconnect while a draft exists: the saved event must be recovered without replaying the write.
    next('reconnect');
    await card.click();
    await page.getByLabel('قيمة المعاملة', { exact: true }).fill('7');
    await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('مسودة لا تمسح');
    await context.setOffline(true);
    const offlineSaved = await save(5, `network-${label}-offline`);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.debt-total-card strong')).toContainText(
      new Intl.NumberFormat('ar-LY').format(
        db
          .prepare(
            "SELECT SUM(current_balance_units) AS total FROM customers WHERE section_key='customer_debts' AND deleted_at IS NULL",
          )
          .get()!.total as number,
      ),
      { timeout: 7000 },
    );
    await expect(page.locator('.ledger-record').filter({ hasText: `network-${label}-offline` })).toBeVisible({
      timeout: 7000,
    });
    await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
    await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toHaveValue('مسودة لا تمسح');
    assert.equal(offlineSaved.balanceUnits, saved.balanceUnits + 5);
    await Promise.allSettled(pendingBodies);
    assert.deepEqual(result.errors, []);
    console.log(`PASS ${label}: visible save ${result.saveToVisibleMs} ms; reconnect and draft preserved.`);
    return result;
  } finally {
    await writer.close();
    await context.close();
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  }
}
try {
  const baseline = process.env.NETWORK_BASELINE_ROOT;
  const results = [];
  if (baseline) {
    const previous = (await import(pathToFileURL(baseline + '/src/server/app.ts').href))
      .createApp as typeof createApp;
    results.push(await measure('before', previous));
  }
  results.push(await measure('after', createApp));
  writeFileSync(
    output + '/comparison.json',
    JSON.stringify(
      {
        method:
          'Isolated synthetic matching workload, 288 accounts plus system accounts, 700 historical changes, same actions. Bytes are local uncompressed response sizes plus separate request metadata estimates; not mobile billing.',
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
