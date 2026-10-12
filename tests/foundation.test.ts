import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp, listen } from '../src/server/app.ts';
import { SCHEMA_VERSION, type ServerConfig } from '../src/server/config.ts';
import { maintainOperationalData, openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { migrations } from '../src/server/db/migrations.ts';
import { hashPassword, verifyPassword } from '../src/server/security/password.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { InternetGate } from '../src/server/internetGate.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'abdo-erp-local-'));
  const database = openDatabase(join(directory, 'test.sqlite'));
  cleanups.push(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test('passwords are salted and verified without storing plaintext', async () => {
  const first = await hashPassword('Correct Horse 123');
  const second = await hashPassword('Correct Horse 123');
  assert.notEqual(first, second);
  assert.equal(first.includes('Correct Horse 123'), false);
  assert.equal(await verifyPassword('Correct Horse 123', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  await assert.rejects(() => hashPassword('letters only password'), /PASSWORD_TOO_WEAK/);
  await assert.rejects(() => hashPassword('1111111111'), /PASSWORD_TOO_WEAK/);
});

test('SQLite enables relations, WAL, and one active customer cycle', () => {
  const database = temporaryDatabase();
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  const journal = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
  assert.equal(Number(foreignKeys.foreign_keys), 1);
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');
  const migration = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number;
  };
  assert.equal(Number(migration.version), Number(SCHEMA_VERSION));
  assert.equal(
    Number((database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='notifications'").get() as { count: number }).count),
    1,
  );
  assert.equal(
    Number((database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name='trg_audit_notifications_for_administration'").get() as { count: number }).count),
    1,
  );
  const feedPlan = database
    .prepare(
      `
    EXPLAIN QUERY PLAN
    SELECT c.id FROM customers c
    WHERE c.organization_id = ? AND c.section_key = ? AND c.deleted_at IS NULL
    ORDER BY c.current_balance_units = 0 ASC, c.financial_updated_at DESC, c.id DESC
    LIMIT 101
  `,
    )
    .all('org-default', 'customer_debts') as Array<{ detail: string }>;
  assert.equal(
    feedPlan.some((step) => step.detail.includes('idx_customers_financial_recency')),
    true,
  );
  assert.equal(
    feedPlan.some((step) => step.detail.includes('TEMP B-TREE')),
    false,
  );
  database
    .prepare('INSERT INTO login_failures(username, remote_address, occurred_at) VALUES (?, ?, ?)')
    .run('old-user', '127.0.0.1', '2000-01-01T00:00:00.000Z');
  database
    .prepare('INSERT INTO login_failures(username, remote_address, occurred_at) VALUES (?, ?, ?)')
    .run('recent-user', '127.0.0.1', new Date().toISOString());
  database
    .prepare(
      `
    INSERT INTO oauth_states(state_hash, mode, created_at, expires_at, remote_address)
    VALUES (?, 'login', ?, ?, ?)
  `,
    )
    .run('expired-state', '2000-01-01T00:00:00.000Z', '2000-01-01T00:01:00.000Z', '127.0.0.1');
  assert.doesNotThrow(() => maintainOperationalData(database));
  assert.equal(
    Number(
      (
        database.prepare("SELECT COUNT(*) AS count FROM login_failures WHERE username='old-user'").get() as {
          count: number;
        }
      ).count,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM login_failures WHERE username='recent-user'")
          .get() as { count: number }
      ).count,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM oauth_states WHERE state_hash='expired-state'")
          .get() as { count: number }
      ).count,
    ),
    0,
  );
});

test('collection batch display numbers are isolated per organization', () => {
  const database = temporaryDatabase();
  const now = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO organizations(id, name, slug, created_at, updated_at)
    VALUES ('org-batch-second', 'مؤسسة دفعات ثانية', 'batch-second', ?, ?)
  `,
    )
    .run(now, now);
  const insert = database.prepare(`
    INSERT INTO collection_batches(
      id, business_date, batch_number, organization_batch_number,
      status, opened_at, organization_id
    ) VALUES (?, '2026-10-01', ?, 1, 'open', ?, ?)
  `);
  insert.run('batch-default-1', 1, now, 'org-default');
  insert.run('batch-second-1', 2, now, 'org-batch-second');
  const rows = database
    .prepare(
      `
    SELECT organization_id, organization_batch_number
    FROM collection_batches ORDER BY batch_number
  `,
    )
    .all() as Array<{ organization_id: string; organization_batch_number: number }>;
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { organization_id: 'org-default', organization_batch_number: 1 },
      { organization_id: 'org-batch-second', organization_batch_number: 1 },
    ],
  );
  assert.throws(() => insert.run('batch-default-duplicate', 3, now, 'org-default'));
});

test('masraweya keeps integer daily rows, automatic carry, and routes its remainder through Egyptian deposits only', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') });
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'mas-admin',
      displayName: 'مدير المصراوية',
      password: 'Masraweya Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'mas-admin', password: 'Masraweya Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };

  const first = await fetch(`${base}/api/masraweya/day?date=2026-09-28`, { headers });
  assert.equal(first.status, 200);
  assert.equal((await json(first)).data.previousValueUnits, 0);
  const saved = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-09-28',
      expectedVersion: 0,
      previousValueUnits: 48000,
      purchasesUnits: 12500,
      entries: [
        { valueUnits: 10000, commissionUnits: 500 },
        { valueUnits: 11000, commissionUnits: 450 },
      ],
    }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await json(saved);
  assert.equal(savedBody.data.workTotalUnits, 21950);
  assert.equal(savedBody.data.finalUnits, 38550);
  assert.equal('exchangeRate' in savedBody.data, false);
  assert.equal('treasuryPreviewUnits' in savedBody.data, false);
  const linkedMasraweya = database
    .prepare(
      `
    SELECT id,current_balance_units,system_link_key FROM customers
    WHERE organization_id='org-default' AND system_link_key='masraweya_remainder'
  `,
    )
    .get() as Record<string, unknown>;
  assert.equal(Number(linkedMasraweya.current_balance_units), 38550);
  const linkedMasraweyaLedger = await json(
    await fetch(`${base}/api/egyptian-deposits/${String(linkedMasraweya.id)}/ledger`, { headers }),
  );
  assert.equal(linkedMasraweyaLedger.data.customer.systemManaged, true);
  assert.equal(linkedMasraweyaLedger.data.customer.balanceUnits, 38550);
  assert.equal(linkedMasraweyaLedger.data.items[0].note, 'رصيد مرتبط تلقائيًا بالقسم المصدر');
  const linkedTreasury = (await json(await fetch(`${base}/api/treasury`, { headers }))).data;
  assert.equal(linkedTreasury.egyptianSourceUnits, 38550);
  assert.equal(linkedTreasury.activeCashUnits, 0, 'linked EGP cards must not alter active cash');
  const protectedChange = await fetch(
    `${base}/api/egyptian-deposits/${String(linkedMasraweya.id)}/transactions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'protected-linked-change-1',
        expectedVersion: Number((linkedMasraweyaLedger.data.customer as Record<string, unknown>).version),
        type: 'debt',
        inputValue: 1,
        calculationMode: 'direct',
        date: new Date().toISOString(),
      }),
    },
  );
  assert.equal(protectedChange.status, 409);
  assert.equal((await json(protectedChange)).error.code, 'SYSTEM_LINK_ACCOUNT_PROTECTED');
  const treasuryBefore = database.prepare('SELECT COUNT(*) AS count FROM treasury_transactions').get() as {
    count: number;
  };
  assert.equal(Number(treasuryBefore.count), 0);
  const finalized = await fetch(`${base}/api/masraweya/day/finalize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ businessDate: '2026-09-28', expectedVersion: 1 }),
  });
  assert.equal(finalized.status, 410);

  const next = await fetch(`${base}/api/masraweya/day?date=2026-09-29`, { headers });
  const nextBody = await json(next);
  assert.equal(nextBody.data.previousValueUnits, 38550, 'carry must happen automatically');
  assert.equal(nextBody.data.carryValueUnits, 38550);
  assert.equal(nextBody.data.carrySourceDate, '2026-09-28');
  const carried = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-09-29',
      expectedVersion: 0,
      previousValueUnits: 38550,
      purchasesUnits: 0,
      entries: [],
    }),
  });
  assert.equal(carried.status, 200);
  assert.equal((await json(carried)).data.previousValueUnits, 38550);
  const invalidDecimal = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-09-30',
      expectedVersion: 0,
      previousValueUnits: 0,
      purchasesUnits: 0,
      entries: [{ valueUnits: 1.5, commissionUnits: 0 }],
    }),
  });
  assert.equal(invalidDecimal.status, 400);
  const impossibleDate = await fetch(`${base}/api/masraweya/day?date=2026-02-31`, { headers });
  assert.equal(impossibleDate.status, 400);
  assert.equal((await json(impossibleDate)).error.code, 'INVALID_BUSINESS_DATE');
  const unsafeTotal = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-10-01',
      expectedVersion: 0,
      previousValueUnits: 38550,
      purchasesUnits: Number.MAX_SAFE_INTEGER,
      entries: [],
    }),
  });
  assert.equal(unsafeTotal.status, 400);
  assert.equal((await json(unsafeTotal)).error.code, 'MASRAWEYA_TOTAL_OUT_OF_RANGE');
});

test('purchases keep exact summaries, merchant isolation, idempotency, and manual day finalization', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'purchase-admin',
      displayName: 'مدير المشتريات',
      password: 'Purchases Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'purchase-admin', password: 'Purchases Admin 123!' }),
  });
  const session = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(session.data.csrfToken),
    'x-client-api-version': '1',
  };
  const first = await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }));
  assert.equal(first.data.day.version, 0);
  assert.equal('treasuryLinked' in first.data, false);
  assert.equal('treasuryPreview' in first.data, false);
  const opening = await fetch(`${base}/api/purchases/al_bayan/opening`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedDayVersion: 0, previousDebtUnits: 1000, previousVodafoneUnits: 500 }),
  });
  assert.equal(opening.status, 200);
  assert.equal(
    Number(
      (
        database
          .prepare(
            `
        SELECT current_balance_units FROM customers
        WHERE organization_id='org-default' AND system_link_key='purchases_vodafone_remainder'
      `,
          )
          .get() as { current_balance_units: number }
      ).current_balance_units,
    ),
    500,
  );
  const createBody = {
    requestId: 'purchase-create-001',
    expectedDayVersion: 1,
    itemCode: 'vodafone_cash',
    itemLabel: 'فودا',
    egpValueUnits: 1000,
    calculationMode: 'divide',
    exchangeRate: '5.5',
    paidUnits: 50,
    vodafoneConsumedUnits: 200,
  };
  const created = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody),
  });
  assert.equal(created.status, 201);
  const replayed = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody),
  });
  assert.equal(replayed.status, 201);
  const reusedWithDifferentPayload = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...createBody, egpValueUnits: 1001 }),
  });
  assert.equal(reusedWithDifferentPayload.status, 409);
  assert.equal((await json(reusedWithDifferentPayload)).error.code, 'REQUEST_ID_REUSED');
  let page = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].resultUnits, 182);
  assert.equal(page.day.totalDebtUnits, 1132);
  assert.equal(page.day.vodafoneRemainingUnits, 1300);
  assert.equal(
    Number(
      (
        database
          .prepare(
            `
        SELECT current_balance_units FROM customers
        WHERE organization_id='org-default' AND system_link_key='purchases_vodafone_remainder'
      `,
          )
          .get() as { current_balance_units: number }
      ).current_balance_units,
    ),
    1300,
  );
  const second = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'purchase-create-002',
      expectedDayVersion: page.day.version,
      itemCode: 'cairo',
      itemLabel: 'القاهرة',
      egpValueUnits: 100,
      calculationMode: 'multiply',
      exchangeRate: '1.25',
      paidUnits: 200,
      vodafoneConsumedUnits: 0,
    }),
  });
  assert.equal(second.status, 201);
  page = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  assert.equal(page.day.totalDebtUnits, 1057);
  assert.equal(page.entries[1].sequence, 2);
  assert.deepEqual(page.registerTotals, {
    resultUnits: 307,
    paidUnits: 250,
    remainingUnits: 1057,
    vodafoneConsumedUnits: 200,
    vodafoneRemainingUnits: 1300,
  });
  const simsim = (await json(await fetch(`${base}/api/purchases/simsim`, { headers }))).data;
  assert.equal(simsim.entries.length, 0);
  assert.equal(simsim.day.totalDebtUnits, 0);
  const finalized = await fetch(`${base}/api/purchases/al_bayan/finalize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'purchase-finalize-001', expectedDayVersion: page.day.version }),
  });
  assert.equal(finalized.status, 200);
  const next = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  assert.equal(next.day.dayNumber, 2);
  assert.equal(next.day.previousDebtUnits, 1057);
  assert.equal(next.day.previousVodafoneUnits, 1300);
  const locked = await fetch(
    `${base}/api/purchases/al_bayan/entries/${encodeURIComponent(page.entries[0].id)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        ...createBody,
        requestId: 'purchase-update-001',
        expectedVersion: page.entries[0].version,
        expectedDayVersion: next.day.version,
      }),
    },
  );
  assert.equal(locked.status, 409);
  let historical = next.entries.find((entry: Record<string, unknown>) => Number(entry.sequence) === 1);
  const opened = await fetch(
    `${base}/api/purchases/al_bayan/days/${encodeURIComponent(String(historical.dayId))}/correction`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ open: true, expectedVersion: historical.dayVersion }),
    },
  );
  assert.equal(opened.status, 200);
  let correctionPage = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  historical = correctionPage.entries.find((entry: Record<string, unknown>) => Number(entry.sequence) === 1);
  const corrected = await fetch(
    `${base}/api/purchases/al_bayan/entries/${encodeURIComponent(String(historical.id))}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        ...createBody,
        requestId: 'purchase-update-002',
        egpValueUnits: 1100,
        expectedVersion: historical.version,
        expectedDayVersion: historical.dayVersion,
      }),
    },
  );
  assert.equal(corrected.status, 200);
  correctionPage = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  historical = correctionPage.entries.find((entry: Record<string, unknown>) => Number(entry.sequence) === 1);
  assert.equal(correctionPage.day.previousDebtUnits, 1075);
  assert.equal(correctionPage.day.previousVodafoneUnits, 1400);
  const closed = await fetch(
    `${base}/api/purchases/al_bayan/days/${encodeURIComponent(String(historical.dayId))}/correction`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ open: false, expectedVersion: historical.dayVersion }),
    },
  );
  assert.equal(closed.status, 200);
  const currentAfterCorrection = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  const consumptionOnly = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'purchase-vodafone-consumption-only-001',
      expectedDayVersion: currentAfterCorrection.day.version,
      itemCode: 'custom',
      itemLabel: 'مستهلك فودافون',
      egpValueUnits: 0,
      calculationMode: 'divide',
      exchangeRate: '1',
      paidUnits: 0,
      vodafoneConsumedUnits: 1500,
    }),
  });
  assert.equal(consumptionOnly.status, 201);
  const afterConsumption = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  assert.equal(afterConsumption.day.totalDebtUnits, 1075);
  assert.equal(afterConsumption.day.vodafoneRemainingUnits, -100);
  assert.deepEqual(afterConsumption.registerTotals, {
    resultUnits: 325,
    paidUnits: 250,
    remainingUnits: 1075,
    vodafoneConsumedUnits: 1700,
    vodafoneRemainingUnits: -100,
  });
  assert.equal(
    Number((database.prepare(`
      SELECT current_balance_units FROM customers
      WHERE organization_id='org-default' AND system_link_key='purchases_vodafone_remainder'
    `).get() as { current_balance_units: number }).current_balance_units),
    -100,
  );
  const treasury = database.prepare('SELECT COUNT(*) count FROM treasury_transactions').get() as {
    count: number;
  };
  assert.equal(Number(treasury.count), 0);
  const paymentOnly = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'purchase-payment-only-001',
      expectedDayVersion: afterConsumption.day.version,
      itemCode: 'standalone_adjustment',
      itemLabel: 'تسديد',
      egpValueUnits: 0,
      calculationMode: 'divide',
      exchangeRate: '1',
      paidUnits: 75,
      vodafoneConsumedUnits: 0,
    }),
  });
  assert.equal(paymentOnly.status, 201);
  const afterPaymentOnly = (await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }))).data;
  assert.equal(afterPaymentOnly.day.totalDebtUnits, 1000);
  assert.equal(afterPaymentOnly.day.vodafoneRemainingUnits, -100);
  assert.equal(afterPaymentOnly.entries.at(-1).resultUnits, 0);
  assert.equal(afterPaymentOnly.entries.at(-1).paidUnits, 75);
  const plan = database
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM purchase_entries WHERE organization_id=? AND merchant_id=? AND deleted_at IS NULL AND sequence<? ORDER BY sequence DESC LIMIT ?`,
    )
    .all('org-default', 'none', Number.MAX_SAFE_INTEGER, 101) as Array<{ detail: string }>;
  assert.equal(
    plan.some((row) => row.detail.includes('idx_purchase_entries_feed')),
    true,
  );
});

test('treasury uses section aggregates while active cash changes only through its own ledger', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'treasury-admin',
      displayName: 'مدير الخزينة',
      password: 'Treasury Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'treasury-admin', password: 'Treasury Admin 123!' }),
  });
  const session = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(session.data.csrfToken),
    'x-client-api-version': '1',
  };
  const createAccount = async (path: string, requestId: string, name: string, openingBalance: number) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId, name, openingBalance }),
    });
    assert.equal(response.status, 201);
    return (await json(response)).data.customer as Record<string, unknown>;
  };
  const customer = await createAccount('/api/customers', 'treasury-customer-1', 'عميل الخزينة', 1000);
  await createAccount('/api/companies', 'treasury-company-1', 'شركة الخزينة', 2000);
  await createAccount('/api/libyan-deposits', 'treasury-lyd-1', 'أمانة ليبية', 300);
  await createAccount('/api/egyptian-deposits', 'treasury-egp-1', 'أمانة مصرية', 1700);
  const rate = await fetch(`${base}/api/egyptian-deposits/exchange-rate`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ egpPerLyd: 17 }),
  });
  assert.equal(rate.status, 200);
  assert.equal((await json(rate)).data.activeForTreasury, true);
  const purchases = await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }));
  const purchase = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'treasury-purchase-1',
      expectedDayVersion: purchases.data.day.version,
      itemCode: 'cairo',
      itemLabel: 'القاهرة',
      egpValueUnits: 100,
      calculationMode: 'multiply',
      exchangeRate: '5',
      paidUnits: 0,
      vodafoneConsumedUnits: 0,
    }),
  });
  assert.equal(purchase.status, 201);

  let dashboard = (await json(await fetch(`${base}/api/treasury`, { headers }))).data;
  assert.equal(dashboard.receivablesUnits, 3000);
  assert.equal(dashboard.liabilitiesUnits, 800);
  assert.equal(dashboard.egyptianConvertedUnits, 100);
  assert.equal(dashboard.activeCashUnits, 0);
  assert.equal(dashboard.netUnits, 2300);

  const cashInBody = {
    requestId: 'treasury-cash-in-1',
    expectedVersion: 0,
    direction: 'in',
    amountUnits: 1000,
    description: 'رصيد افتتاحي للنقد النشط',
  };
  const cashIn = await fetch(`${base}/api/treasury/cash-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cashInBody),
  });
  assert.equal(cashIn.status, 201);
  const cashReplay = await fetch(`${base}/api/treasury/cash-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify(cashInBody),
  });
  assert.equal(cashReplay.status, 201);
  assert.equal((await json(cashReplay)).meta.replayed, true);
  const reused = await fetch(`${base}/api/treasury/cash-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...cashInBody, amountUnits: 1001 }),
  });
  assert.equal(reused.status, 409);
  assert.equal((await json(reused)).error.code, 'REQUEST_ID_REUSED');
  const cashOut = await fetch(`${base}/api/treasury/cash-entries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'treasury-cash-out-1',
      expectedVersion: 1,
      direction: 'out',
      amountUnits: 250,
      description: 'مصروف نقدي',
    }),
  });
  assert.equal(cashOut.status, 201);

  dashboard = (await json(await fetch(`${base}/api/treasury`, { headers }))).data;
  assert.equal(dashboard.activeCashUnits, 750);
  assert.equal(dashboard.netUnits, 3050);
  const payment = await fetch(`${base}/api/customers/${String(customer.id)}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'treasury-customer-payment-1',
      expectedVersion: 1,
      type: 'payment',
      paymentMode: 'partial',
      inputValue: 400,
      calculationMode: 'direct',
      date: new Date().toISOString(),
    }),
  });
  assert.equal(payment.status, 201);
  dashboard = (await json(await fetch(`${base}/api/treasury`, { headers }))).data;
  assert.equal(dashboard.receivablesUnits, 2600);
  assert.equal(dashboard.activeCashUnits, 750, 'customer payments must never post directly to active cash');
  assert.equal(dashboard.netUnits, 2650);
  const ledger = (await json(await fetch(`${base}/api/treasury/cash-ledger`, { headers }))).data;
  assert.deepEqual(
    ledger.items.map((entry: Record<string, unknown>) => entry.sequence),
    [1, 2],
  );
  assert.deepEqual(
    ledger.items.map((entry: Record<string, unknown>) => entry.balanceAfterUnits),
    [1000, 750],
  );
  assert.equal(
    Number(
      (database.prepare('SELECT COUNT(*) AS count FROM treasury_cash_entries').get() as { count: number })
        .count,
    ),
    2,
  );
  const audit = (await json(await fetch(`${base}/api/audit-log`, { headers }))).data;
  assert.equal(
    audit.items.some((entry: Record<string, unknown>) => entry.action === 'treasury.cash.in'),
    true,
  );
  assert.equal(
    audit.items.some((entry: Record<string, unknown>) => entry.action === 'treasury.cash.out'),
    true,
  );
  const financialLedger = (await json(await fetch(`${base}/api/financial-ledger`, { headers }))).data;
  assert.equal(financialLedger.items.length >= 8, true);
  assert.equal(
    financialLedger.items.some(
      (entry: Record<string, unknown>) =>
        entry.sectionKey === 'customer_debts' && entry.entryKind === 'payment' && entry.effectUnits === -400,
    ),
    true,
  );
  assert.equal(
    financialLedger.items.filter((entry: Record<string, unknown>) => entry.sectionKey === 'treasury').length,
    2,
    'cash retries must not duplicate the financial ledger entry',
  );
  const treasuryOnly = (
    await json(await fetch(`${base}/api/financial-ledger?section=treasury&currency=LYD`, { headers }))
  ).data;
  assert.deepEqual(
    treasuryOnly.items.map((entry: Record<string, unknown>) => entry.effectUnits),
    [-250, 1000],
  );
});

test('legacy schema version 3 upgrades to the permanent ledger instead of skipping it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'abdo-erp-legacy-v3-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  for (const migration of migrations.filter((item) => item.version <= 2)) {
    legacy.exec(migration.sql);
    legacy
      .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString());
  }
  legacy.exec(
    "ALTER TABLE customers ADD COLUMN collector TEXT CHECK (collector IN ('abdullah', 'ali') OR collector IS NULL)",
  );
  legacy
    .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (3, ?, ?)')
    .run('remove-collections-and-collector-workspace', new Date().toISOString());
  legacy.close();

  const upgraded = openDatabase(path);
  cleanups.push(() => {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const customerColumns = (
    upgraded.prepare('PRAGMA table_info(customers)').all() as Array<{ name: string }>
  ).map((column) => column.name);
  const transactionColumns = (
    upgraded.prepare('PRAGMA table_info(debt_transactions)').all() as Array<{ name: string }>
  ).map((column) => column.name);
  assert.equal(customerColumns.includes('collector'), false);
  assert.equal(customerColumns.includes('inactive_since'), true);
  assert.equal(customerColumns.includes('ledger_next_sequence'), true);
  assert.equal(transactionColumns.includes('transaction_status'), true);
  assert.equal(transactionColumns.includes('customer_sequence'), true);
  const migration = upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number;
  };
  assert.equal(Number(migration.version), Number(SCHEMA_VERSION));
  const identityTables = upgraded
    .prepare(
      `
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN ('user_identities', 'account_requests', 'user_section_access')
  `,
    )
    .get() as { count: number };
  assert.equal(Number(identityTables.count), 3);
});

async function startApiInstance(database: AppDatabase, overrides: Partial<ServerConfig> = {}) {
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
    ...overrides,
  };
  const server = createApp(database, config);
  await listen(server, config.host, 0);
  cleanups.push(() => server.close());
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, server };
}

async function startApi(database: AppDatabase, overrides: Partial<ServerConfig> = {}) {
  return (await startApiInstance(database, overrides)).base;
}

test('first-admin setup token and request size limit are enforced', async () => {
  const localOnlyDatabase = temporaryDatabase();
  const localOnlyBase = await startApi(localOnlyDatabase);
  const forgedLoopback = await fetch(`${localOnlyBase}/api/setup/admin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1, 10.20.30.40',
    },
    body: JSON.stringify({ username: 'forged', displayName: 'طلب بعيد', password: 'Local Admin 123!' }),
  });
  assert.equal(forgedLoopback.status, 403);
  const noUnexpectedAdmin = localOnlyDatabase.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  assert.equal(Number(noUnexpectedAdmin.count), 0);

  const protectedDatabase = temporaryDatabase();
  const protectedBase = await startApi(protectedDatabase, { setupToken: 'one-time-setup-token' });
  const denied = await fetch(`${protectedBase}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير', password: 'Local Admin 123!' }),
  });
  assert.equal(denied.status, 403);
  const accepted = await fetch(`${protectedBase}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-token': 'one-time-setup-token' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير', password: 'Local Admin 123!' }),
  });
  assert.equal(accepted.status, 201);

  const largeDatabase = temporaryDatabase();
  const largeBase = await startApi(largeDatabase);
  const tooLarge = await fetch(`${largeBase}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير', password: 'x'.repeat(1_048_576) }),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal((await json(tooLarge)).error.code, 'REQUEST_BODY_TOO_LARGE');
});

test('login throttling follows the account across addresses and a valid login clears its failures', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'rate-admin',
      displayName: 'مدير الحماية',
      password: 'Rate Admin 123!',
    }),
  });
  const now = new Date().toISOString();
  const insertFailure = database.prepare(`
    INSERT INTO login_failures(username,remote_address,occurred_at) VALUES(?,?,?)
  `);
  for (let index = 0; index < 8; index += 1) {
    insertFailure.run('distributed-target', `10.20.0.${index + 1}`, now);
  }
  const blocked = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-api-version': '1',
      'x-forwarded-for': '10.30.0.1',
    },
    body: JSON.stringify({ username: 'distributed-target', password: 'Wrong Password' }),
  });
  assert.equal(blocked.status, 429);

  for (let index = 0; index < 7; index += 1) {
    insertFailure.run('rate-admin', `10.40.0.${index + 1}`, now);
  }
  const accepted = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-api-version': '1',
      'x-forwarded-for': '10.50.0.1',
    },
    body: JSON.stringify({ username: 'rate-admin', password: 'Rate Admin 123!' }),
  });
  assert.equal(accepted.status, 200);
  const remaining = database
    .prepare(
      `
    SELECT COUNT(*) AS count FROM login_failures WHERE username='rate-admin'
  `,
    )
    .get() as { count: number };
  assert.equal(Number(remaining.count), 0);
});

test('Google OAuth start is rate limited per real client address', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database, {
    googleClientId: 'test-client.apps.googleusercontent.com',
    googleClientSecret: 'test-secret',
    googleRedirectUri: 'https://localhost/api/auth/google/callback',
    secureCookie: true,
  });
  let firstState = '';
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(`${base}/api/auth/google/start?mode=login`, {
      headers: { 'x-forwarded-for': '10.60.0.5' },
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    if (index === 0) {
      const cookie = response.headers.get('set-cookie') ?? '';
      assert.match(cookie, /^abdo_oauth_binding=/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(cookie, /Secure/);
      const location = response.headers.get('location') ?? '';
      firstState = new URL(location).searchParams.get('state') ?? '';
      assert.equal(new URL(location).searchParams.get('code_challenge_method'), 'S256');
      assert.ok(new URL(location).searchParams.get('code_challenge'));
      assert.ok(new URL(location).searchParams.get('nonce'));
    }
  }
  const limited = await fetch(`${base}/api/auth/google/start?mode=login`, {
    headers: { 'x-forwarded-for': '10.60.0.5' },
    redirect: 'manual',
  });
  assert.equal(limited.status, 429);
  assert.equal((await json(limited)).error.code, 'GOOGLE_AUTH_RATE_LIMITED');
  const otherAddress = await fetch(`${base}/api/auth/google/start?mode=login`, {
    headers: { 'x-forwarded-for': '10.60.0.6' },
    redirect: 'manual',
  });
  assert.equal(otherAddress.status, 302);
  const unboundCallback = await fetch(
    `${base}/api/auth/google/callback?state=${encodeURIComponent(firstState)}&code=not-exchanged`,
  );
  assert.equal(unboundCallback.status, 400);
  assert.equal((await json(unboundCallback)).error.code, 'GOOGLE_BROWSER_BINDING_INVALID');
  const states = database
    .prepare(
      `
    SELECT remote_address, COUNT(*) AS count FROM oauth_states GROUP BY remote_address ORDER BY remote_address
  `,
    )
    .all() as Array<{ remote_address: string; count: number }>;
  assert.deepEqual(
    states.map((row) => ({ ...row })),
    [
      { remote_address: '10.60.0.5', count: 20 },
      { remote_address: '10.60.0.6', count: 1 },
    ],
  );
  const hardenedStates = database
    .prepare(
      `
    SELECT COUNT(*) AS count FROM oauth_states
    WHERE browser_binding_hash IS NOT NULL AND code_verifier IS NOT NULL AND nonce_hash IS NOT NULL
  `,
    )
    .get() as { count: number };
  assert.equal(Number(hardenedStates.count), 21);
});

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

test('first local financial path is atomic, idempotent, and versioned', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);

  const setup = await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      displayName: 'مدير الاختبار',
      password: 'Local Admin 123!',
    }),
  });
  assert.equal(setup.status, 201);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-api-version': '1',
    },
    body: JSON.stringify({ username: 'admin', password: 'Local Admin 123!' }),
  });
  assert.equal(login.status, 200);
  const loginBody = await json(login);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const csrf = String(loginBody.data.csrfToken);
  const mutationHeaders = {
    'content-type': 'application/json',
    cookie,
    'x-csrf-token': csrf,
    'x-client-api-version': '1',
  };

  const malformedPath = await fetch(`${base}/api/customers/%ZZ`, { headers: mutationHeaders });
  assert.equal(malformedPath.status, 400);
  assert.equal((await json(malformedPath)).error.code, 'INVALID_PATH_SEGMENT');
  const fractionalLimit = await fetch(`${base}/api/customers?limit=20.5`, { headers: mutationHeaders });
  assert.equal(fractionalLimit.status, 400);
  assert.equal((await json(fractionalLimit)).error.code, 'INVALID_PAGE_LIMIT');
  const infiniteEventCursor = await fetch(`${base}/api/event-changes?after=Infinity`, {
    headers: mutationHeaders,
  });
  assert.equal(infiniteEventCursor.status, 400);
  assert.equal((await json(infiniteEventCursor)).error.code, 'INVALID_EVENT_CURSOR');

  const unsafeOpening = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-unsafe-opening-0001',
      name: 'رصيد غير آمن',
      openingBalance: 9_007_199_255,
    }),
  });
  assert.equal(unsafeOpening.status, 400);
  assert.equal((await json(unsafeOpening)).error.code, 'INVALID_OPENING_BALANCE');

  const customerRequest = {
    requestId: 'test-create-customer-0001',
    name: 'عميل تجريبي',
    openingBalance: 100,
  };
  const customerResponse = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(customerRequest),
  });
  assert.equal(customerResponse.status, 201);
  const customerBody = await json(customerResponse);
  const customerId = String(customerBody.data.customer.id);
  assert.equal(customerBody.data.customer.balanceUnits, 100);

  const customerReplay = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(customerRequest),
  });
  assert.equal(customerReplay.status, 201);
  assert.equal((await json(customerReplay)).meta.replayed, true);
  const customerCount = database
    .prepare('SELECT COUNT(*) AS count FROM customers WHERE system_link_key IS NULL')
    .get() as {
    count: number;
  };
  assert.equal(Number(customerCount.count), 1);

  const impossibleTransactionDate = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-invalid-date-0001',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 10,
      calculationMode: 'direct',
      date: '2026-02-31',
    }),
  });
  assert.equal(impossibleTransactionDate.status, 400);
  assert.equal((await json(impossibleTransactionDate)).error.code, 'INVALID_TRANSACTION_DATE');

  const debtRequest = {
    requestId: 'test-debt-0001',
    expectedVersion: 1,
    type: 'debt',
    inputValue: 10,
    calculationMode: 'multiply',
    factor: 3,
    note: 'اختبار الاقتطاع المطابق للمصدر',
  };
  const debtResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(debtRequest),
  });
  assert.equal(debtResponse.status, 201);
  const debtBody = await json(debtResponse);
  assert.equal(debtBody.data.transaction.amountUnits, 30);
  assert.equal(debtBody.data.balanceUnits, 130);
  assert.equal(debtBody.data.customerVersion, 2);

  const debtReplay = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(debtRequest),
  });
  assert.equal(debtReplay.status, 201);
  assert.equal((await json(debtReplay)).meta.replayed, true);

  const staleResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-debt-stale-0002',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 5,
    }),
  });
  assert.equal(staleResponse.status, 409);
  assert.equal((await json(staleResponse)).error.code, 'VERSION_CONFLICT');

  const paymentRequest = {
    requestId: 'test-full-payment-0001',
    expectedVersion: 2,
    type: 'payment',
    paymentMode: 'full',
    inputValue: 1,
  };
  const paymentResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(paymentRequest),
  });
  assert.equal(paymentResponse.status, 201);
  const paymentBody = await json(paymentResponse);
  assert.equal(paymentBody.data.transaction.amountUnits, 130);
  assert.equal(paymentBody.data.balanceUnits, 0);

  const paymentReplay = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(paymentRequest),
  });
  assert.equal(paymentReplay.status, 201);
  assert.equal((await json(paymentReplay)).meta.replayed, true);
  const treasuryRows = database
    .prepare(
      `
    SELECT COUNT(*) AS count FROM treasury_transactions
    WHERE source = 'customer_payment'
  `,
    )
    .get() as { count: number };
  assert.equal(Number(treasuryRows.count), 0);
  const debtRows = database.prepare('SELECT COUNT(*) AS count FROM debt_transactions').get() as {
    count: number;
  };
  assert.equal(Number(debtRows.count), 3);

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const agedDebtResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-aged-debt-0001',
      expectedVersion: 3,
      type: 'debt',
      inputValue: 50,
      date: fiveDaysAgo,
    }),
  });
  assert.equal(agedDebtResponse.status, 201);
  let customersResponse = await fetch(`${base}/api/customers`, { headers: { cookie } });
  let customersBody = await json(customersResponse);
  assert.ok(Number(customersBody.data.items[0].debtAgeDays) >= 4);
  assert.ok(customersBody.data.items[0].debtStartedAt);

  const creditResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-credit-payment-0001',
      expectedVersion: 4,
      type: 'payment',
      paymentMode: 'partial',
      inputValue: 70,
    }),
  });
  assert.equal(creditResponse.status, 201);
  assert.equal((await json(creditResponse)).data.balanceUnits, -20);
  customersResponse = await fetch(`${base}/api/customers`, { headers: { cookie } });
  customersBody = await json(customersResponse);
  assert.equal(customersBody.data.items[0].debtStartedAt, null);
  assert.equal(customersBody.data.items[0].debtAgeDays, null);

  const freshDebtResponse = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-fresh-debt-0001',
      expectedVersion: 5,
      type: 'debt',
      inputValue: 30,
    }),
  });
  assert.equal(freshDebtResponse.status, 201);
  assert.equal((await json(freshDebtResponse)).data.balanceUnits, 10);
  customersResponse = await fetch(`${base}/api/customers`, { headers: { cookie } });
  customersBody = await json(customersResponse);
  assert.equal(customersBody.data.items[0].debtAgeDays, 0);
  const transactionCountBeforeOverflow = Number(
    (
      database
        .prepare(
          `
    SELECT COUNT(*) AS count FROM debt_transactions WHERE customer_id=?
  `,
        )
        .get(customerId) as { count: number }
    ).count,
  );
  database
    .prepare('UPDATE customers SET current_balance_units=? WHERE id=?')
    .run(Number.MAX_SAFE_INTEGER, customerId);
  const overflow = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      requestId: 'test-balance-overflow-0001',
      expectedVersion: 6,
      type: 'debt',
      inputValue: 1,
      calculationMode: 'direct',
    }),
  });
  assert.equal(overflow.status, 400);
  assert.equal((await json(overflow)).error.code, 'BALANCE_OUT_OF_RANGE');
  const transactionCountAfterOverflow = Number(
    (
      database
        .prepare(
          `
    SELECT COUNT(*) AS count FROM debt_transactions WHERE customer_id=?
  `,
        )
        .get(customerId) as { count: number }
    ).count,
  );
  assert.equal(transactionCountAfterOverflow, transactionCountBeforeOverflow);
});

test('customer ledger paginates newest rows and preserves running balance', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'ledger-page-admin',
      displayName: 'مدير صفحات السجل',
      password: 'Ledger Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'ledger-page-admin', password: 'Ledger Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const created = await json(
    await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: 'ledger-page-customer', name: 'عميل سجل طويل', openingBalance: 0 }),
    }),
  );
  const customerId = String(created.data.customer.id);
  for (let index = 1; index <= 105; index += 1) {
    const response = await fetch(`${base}/api/customers/${customerId}/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: `ledger-page-operation-${index}`,
        expectedVersion: index,
        type: 'debt',
        inputValue: 1,
        calculationMode: 'direct',
      }),
    });
    assert.equal(response.status, 201);
  }
  const newest = (
    await json(await fetch(`${base}/api/customers/${customerId}/ledger?limit=100`, { headers }))
  ).data;
  assert.equal(newest.totalItems, 105);
  assert.equal(newest.items.length, 100);
  assert.deepEqual([newest.items[0].sequence, newest.items.at(-1).sequence], [6, 105]);
  assert.equal(newest.pageOpeningBalanceUnits, 5);
  assert.equal(newest.nextCursor, '6');
  const older = (
    await json(await fetch(`${base}/api/customers/${customerId}/ledger?limit=100&before=6`, { headers }))
  ).data;
  assert.deepEqual(
    older.items.map((item: any) => item.sequence),
    [1, 2, 3, 4, 5],
  );
  assert.equal(older.pageOpeningBalanceUnits, 0);
  assert.equal(older.nextCursor, null);
});

test('background change feed returns the changed card without a page reload', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'live-admin',
      displayName: 'مدير المزامنة',
      password: 'Live Updates 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'live-admin', password: 'Live Updates 123!' }),
  });
  const loginBody = await json(login);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const headers = {
    'content-type': 'application/json',
    cookie,
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const created = await json(
    await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: 'live-customer-0001', name: 'عميل التحديث', openingBalance: 100 }),
    }),
  );
  const customerId = String(created.data.customer.id);
  const firstFeed = await json(await fetch(`${base}/api/event-changes?after=0`, { headers }));
  const createdEvent = firstFeed.data.events.find(
    (event: Record<string, unknown>) => event.aggregateId === customerId,
  );
  assert.equal(createdEvent.topic, 'customer.changed');

  await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'live-debt-0001',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 50,
      calculationMode: 'direct',
      date: new Date().toISOString(),
    }),
  });
  const secondFeed = await json(
    await fetch(`${base}/api/event-changes?after=${createdEvent.sequence}`, { headers }),
  );
  assert.equal(
    secondFeed.data.events.some(
      (event: Record<string, unknown>) =>
        event.topic === 'customer.ledger.changed' && event.aggregateId === customerId,
    ),
    true,
  );
  const snapshot = await json(await fetch(`${base}/api/customers/${customerId}`, { headers }));
  assert.equal(snapshot.data.balanceUnits, 150);
  assert.equal(snapshot.data.version, 2);
});

test('graceful shutdown closes realtime streams before draining the server', async () => {
  const database = temporaryDatabase();
  const { base, server } = await startApiInstance(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'shutdown-admin',
      displayName: 'مدير الإغلاق',
      password: 'Shutdown Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'shutdown-admin', password: 'Shutdown Admin 123!' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const abort = new AbortController();
  const stream = await fetch(`${base}/api/events?after=0`, {
    headers: { cookie },
    signal: abort.signal,
  });
  assert.equal(stream.status, 200);
  server.closeRealtimeConnections();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.race([
    closed,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('server shutdown timed out')), 2_000),
    ),
  ]);
  abort.abort();
  assert.equal(server.listening, false);
});

test('company debts use an independent section with the same permanent ledger rules', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'company-admin',
      displayName: 'مدير الشركات',
      password: 'Company Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'company-admin', password: 'Company Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const created = await fetch(`${base}/api/companies`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'company-create-0001', name: 'شركة الاختبار', openingBalance: 75 }),
  });
  assert.equal(created.status, 201);
  const company = (await json(created)).data.customer;
  const customerList = await json(
    await fetch(`${base}/api/customers`, { headers: { cookie: headers.cookie } }),
  );
  const companyList = await json(
    await fetch(`${base}/api/companies`, { headers: { cookie: headers.cookie } }),
  );
  assert.equal(customerList.data.items.length, 0);
  assert.equal(companyList.data.items.length, 1);
  assert.equal(companyList.data.items[0].name, 'شركة الاختبار');
  const transaction = await fetch(`${base}/api/companies/${company.id}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'company-debt-0001',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 25,
      calculationMode: 'direct',
      date: new Date().toISOString(),
    }),
  });
  assert.equal(transaction.status, 201);
  const ledger = await json(
    await fetch(`${base}/api/companies/${company.id}/ledger`, { headers: { cookie: headers.cookie } }),
  );
  assert.equal(ledger.data.customer.balanceUnits, 100);
  assert.deepEqual(
    ledger.data.items.map((item: Record<string, unknown>) => item.sequence),
    [1, 2],
  );
  assert.ok(String(ledger.data.items[1].referenceNo).startsWith('COMP-'));
});

test('deposit sections keep independent LYD and EGP ledgers without treasury posting', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'deposit-admin',
      displayName: 'مدير الأمانات',
      password: 'Deposit Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'deposit-admin', password: 'Deposit Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  for (const [section, name, currency] of [
    ['libyan-deposits', 'أمانة ليبية', 'LYD'],
    ['egyptian-deposits', 'أمانة مصرية', 'EGP'],
  ] as const) {
    const created = await fetch(`${base}/api/${section}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: `${section}-create-0001`, name, openingBalance: 100 }),
    });
    assert.equal(created.status, 201);
    const account = (await json(created)).data.customer;
    assert.equal(account.currency, currency);
    const outgoing = await fetch(`${base}/api/${section}/${account.id}/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: `${section}-out-0001`,
        expectedVersion: 1,
        type: 'payment',
        paymentMode: 'partial',
        inputValue: 150,
        calculationMode: 'direct',
        date: new Date().toISOString(),
      }),
    });
    assert.equal(outgoing.status, 201);
    const ledger = await json(
      await fetch(`${base}/api/${section}/${account.id}/ledger`, { headers: { cookie: headers.cookie } }),
    );
    assert.equal(ledger.data.customer.balanceUnits, -50);
    assert.equal(ledger.data.customer.currency, currency);
  }
  const treasury = database.prepare('SELECT COUNT(*) AS count FROM treasury_transactions').get() as {
    count: number;
  };
  assert.equal(Number(treasury.count), 0);
});

test('business writes reject an old client before accepting data', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير', password: 'Local Admin 123!' }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'admin', password: 'Local Admin 123!' }),
  });
  const body = await json(login);
  const response = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
      'x-csrf-token': String(body.data.csrfToken),
      'x-client-api-version': '0',
    },
    body: JSON.stringify({ requestId: 'old-client-test-1', name: 'لن يحفظ' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await json(response)).error.code, 'CLIENT_VERSION_MISMATCH');
  const count = database
    .prepare('SELECT COUNT(*) AS count FROM customers WHERE system_link_key IS NULL')
    .get() as { count: number };
  assert.equal(Number(count.count), 0);
});

test('a resumed session rotates CSRF and rejects the previous token', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير', password: 'Local Admin 123!' }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'admin', password: 'Local Admin 123!' }),
  });
  const loginBody = await json(login);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const rotatedResponse = await fetch(`${base}/api/auth/csrf`, { headers: { cookie } });
  assert.equal(rotatedResponse.status, 200);
  const rotatedBody = await json(rotatedResponse);
  assert.notEqual(rotatedBody.data.csrfToken, loginBody.data.csrfToken);

  const stale = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': String(loginBody.data.csrfToken),
      'x-client-api-version': '1',
    },
    body: JSON.stringify({ requestId: 'csrf-stale-token-test', name: 'لن يحفظ' }),
  });
  assert.equal(stale.status, 403);
  assert.equal((await json(stale)).error.code, 'CSRF_REJECTED');

  const accepted = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': String(rotatedBody.data.csrfToken),
      'x-client-api-version': '1',
    },
    body: JSON.stringify({ requestId: 'csrf-current-token-test', name: 'عميل آمن' }),
  });
  assert.equal(accepted.status, 201);
});

test('built Arabic interface and immutable assets are served locally', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(page.headers.get('permissions-policy') ?? '', /camera=\(\)/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(page.headers.get('x-permitted-cross-domain-policies'), 'none');
  const html = await page.text();
  assert.match(html, /lang="ar" dir="rtl"/);
  const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(assetPath);
  const asset = await fetch(`${base}${assetPath}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  assert.match(asset.headers.get('content-type') ?? '', /javascript/);
});

test('employee permissions are enforced immediately and deactivation revokes access', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'المدير', password: 'Local Admin 123!' }),
  });
  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'admin', password: 'Local Admin 123!' }),
  });
  const adminBody = await json(adminLogin);
  const adminHeaders = {
    'content-type': 'application/json',
    cookie: adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(adminBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  database
    .prepare(
      `
    INSERT INTO account_requests(
      id, organization_id, provider, provider_subject, email, display_name, status, requested_at
    ) VALUES ('google-request-1', 'org-default', 'google', 'google-subject-1', 'google.employee@example.com',
      'موظف جوجل', 'pending', CURRENT_TIMESTAMP)
  `,
    )
    .run();
  const requests = await fetch(`${base}/api/account-requests`, { headers: { cookie: adminHeaders.cookie } });
  assert.equal(requests.status, 200);
  assert.equal((await json(requests)).data.items[0].email, 'google.employee@example.com');
  const approved = await fetch(`${base}/api/account-requests/google-request-1/decision`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ expectedVersion: 1, decision: 'approve', customerDebtsAccess: 'manage' }),
  });
  assert.equal(approved.status, 200);
  const googleUser = database
    .prepare(
      `
    SELECT u.password_login_enabled, i.email, a.access_level
    FROM users u JOIN user_identities i ON i.user_id = u.id
    JOIN user_section_access a ON a.user_id = u.id AND a.section_key = 'customer_debts'
    WHERE u.email = 'google.employee@example.com'
  `,
    )
    .get() as Record<string, unknown>;
  assert.equal(Number(googleUser.password_login_enabled), 0);
  assert.equal(String(googleUser.email), 'google.employee@example.com');
  assert.equal(String(googleUser.access_level), 'manage');
  database
    .prepare("UPDATE users SET password_hash = ? WHERE email = 'google.employee@example.com'")
    .run(await hashPassword('Google Password 123!'));
  const disabledPasswordLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'google.employee', password: 'Google Password 123!' }),
  });
  assert.equal(disabledPasswordLogin.status, 401, 'Google-only accounts must reject password login');
  const created = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      username: 'reader',
      displayName: 'موظف القراءة',
      password: 'Reader Pass 123!',
      permissions: ['debts.read'],
    }),
  });
  assert.equal(created.status, 201);
  const employee = (await json(created)).data.user;
  assert.deepEqual(employee.permissions, ['debts.read']);

  const employeeLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'reader', password: 'Reader Pass 123!' }),
  });
  assert.equal(employeeLogin.status, 200);
  const employeeBody = await json(employeeLogin);
  const employeeHeaders = {
    'content-type': 'application/json',
    cookie: employeeLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(employeeBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  assert.equal(employeeBody.data.user.mustChangePassword, true);
  assert.equal(
    (await fetch(`${base}/api/customers`, { headers: { cookie: employeeHeaders.cookie } })).status,
    403,
  );
  const changedPassword = await fetch(`${base}/api/auth/change-password`, {
    method: 'POST',
    headers: employeeHeaders,
    body: JSON.stringify({ currentPassword: 'Reader Pass 123!', newPassword: 'Reader Personal 456!' }),
  });
  assert.equal(changedPassword.status, 200);
  assert.equal(
    (await fetch(`${base}/api/customers`, { headers: { cookie: employeeHeaders.cookie } })).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/audit-log`, { headers: { cookie: employeeHeaders.cookie } })).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/financial-ledger`, { headers: { cookie: employeeHeaders.cookie } })).status,
    403,
  );
  const customerEvent = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ requestId: 'event-visible-customer-1', name: 'حدث عميل ظاهر', openingBalance: 5 }),
  });
  const companyEvent = await fetch(`${base}/api/companies`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ requestId: 'event-hidden-company-1', name: 'حدث شركة محجوب', openingBalance: 5 }),
  });
  assert.equal(customerEvent.status, 201);
  assert.equal(companyEvent.status, 201);
  const filteredEvents = await json(
    await fetch(`${base}/api/event-changes?after=0`, {
      headers: { cookie: employeeHeaders.cookie },
    }),
  );
  assert.equal(
    filteredEvents.data.events.some((event: any) => event.topic.startsWith('customer.')),
    true,
  );
  assert.equal(
    filteredEvents.data.events.some((event: any) => event.topic.startsWith('company.')),
    false,
  );
  const denied = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: employeeHeaders,
    body: JSON.stringify({ requestId: 'reader-denied-write-1', name: 'عملية مرفوضة' }),
  });
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).error.code, 'PERMISSION_DENIED');

  const promoted = await fetch(`${base}/api/users/${employee.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({
      expectedVersion: employee.version + 1,
      displayName: employee.displayName,
      isActive: true,
      permissions: ['debts.read', 'debts.write'],
    }),
  });
  assert.equal(promoted.status, 200);
  const promotedUser = (await json(promoted)).data.user;
  const accepted = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers: employeeHeaders,
    body: JSON.stringify({ requestId: 'writer-accepted-write-1', name: 'عملية مسموحة' }),
  });
  assert.equal(accepted.status, 201);

  const deactivated = await fetch(`${base}/api/users/${employee.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({
      expectedVersion: promotedUser.version,
      displayName: promotedUser.displayName,
      isActive: false,
      permissions: promotedUser.permissions,
    }),
  });
  assert.equal(deactivated.status, 200);
  assert.equal(
    (await fetch(`${base}/api/customers`, { headers: { cookie: employeeHeaders.cookie } })).status,
    401,
  );
});

test('an administrator password reset revokes sessions and requires the employee to change it', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'reset-admin',
      displayName: 'مدير إعادة التعيين',
      password: 'Reset Admin 123!',
    }),
  });
  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'reset-admin', password: 'Reset Admin 123!' }),
  });
  const adminBody = await json(adminLogin);
  const adminHeaders = {
    'content-type': 'application/json',
    cookie: adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(adminBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const createdResponse = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      username: 'reset-employee',
      displayName: 'موظف إعادة التعيين',
      password: 'Initial Employee 123!',
      permissions: ['debts.read'],
      customerDebtsAccess: 'read',
    }),
  });
  const employee = (await json(createdResponse)).data.user;
  const employeeLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'reset-employee', password: 'Initial Employee 123!' }),
  });
  const employeeBody = await json(employeeLogin);
  const employeeCookie = employeeLogin.headers.get('set-cookie')?.split(';')[0] ?? '';

  const resetResponse = await fetch(`${base}/api/users/${employee.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({
      expectedVersion: employee.version,
      displayName: employee.displayName,
      isActive: true,
      permissions: ['debts.read'],
      customerDebtsAccess: 'read',
      password: 'Reset Employee 456!',
    }),
  });
  assert.equal(resetResponse.status, 200);
  assert.equal((await json(resetResponse)).data.user.mustChangePassword, true);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: employeeCookie } })).status, 401);

  const resetLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'reset-employee', password: 'Reset Employee 456!' }),
  });
  assert.equal(resetLogin.status, 200);
  const resetLoginBody = await json(resetLogin);
  assert.equal(resetLoginBody.data.user.mustChangePassword, true);
  const restricted = await fetch(`${base}/api/customers`, {
    headers: { cookie: resetLogin.headers.get('set-cookie')?.split(';')[0] ?? '' },
  });
  assert.equal(restricted.status, 403);
  assert.equal((await json(restricted)).error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.ok(employeeBody.data.csrfToken);
});

test('customer record contains identity and account fields without an assignment field', () => {
  const database = temporaryDatabase();
  const columns = database.prepare('PRAGMA table_info(customers)').all() as Array<{ name: string }>;
  assert.deepEqual(
    columns.map((column) => column.name),
    [
      'id',
      'name',
      'normalized_name',
      'phone',
      'account_type',
      'version',
      'created_at',
      'updated_at',
      'deleted_at',
      'organization_id',
      'is_pinned',
      'inactive_since',
      'ledger_next_sequence',
      'section_key',
      'current_balance_units',
      'debt_started_at',
      'financial_updated_at',
      'system_link_key',
      'phone_normalized',
      'zero_review_pending',
      'zero_review_financial_version',
      'zero_reviewed_at',
      'zero_reviewed_by',
      'zero_reviewed_by_name',
    ],
  );
});

test('customer feed paginates and searches beyond the first page with section-wide summaries', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'page-admin',
      displayName: 'مدير الصفحات',
      password: 'Local Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'page-admin', password: 'Local Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  for (let index = 0; index < 120; index += 1) {
    const created = await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: `pagination-customer-${String(index).padStart(4, '0')}`,
        name: `عميل صفحات ${String(index).padStart(4, '0')}`,
        phone: `092${String(index).padStart(7, '0')}`,
        openingBalance: 0,
      }),
    });
    assert.equal(created.status, 201);
  }
  const first = (await json(await fetch(`${base}/api/customers?limit=50&filter=smart`, { headers }))).data;
  assert.equal(first.items.length, 50);
  assert.equal(first.totalItems, 120);
  assert.equal(first.summary.activeCards, 0);
  assert.equal(first.summary.totalDebt, 0);
  assert.ok(first.nextCursor);
  const second = (
    await json(
      await fetch(
        `${base}/api/customers?limit=50&filter=smart&cursor=${encodeURIComponent(first.nextCursor)}`,
        { headers },
      ),
    )
  ).data;
  assert.equal(second.items.length, 50);
  assert.equal(new Set([...first.items, ...second.items].map((item: any) => item.id)).size, 100);
  const searched = (
    await json(
      await fetch(`${base}/api/customers?limit=20&q=${encodeURIComponent('صفحات 0119')}`, { headers }),
    )
  ).data;
  assert.equal(searched.items.length, 1);
  assert.equal(searched.items[0].name, 'عميل صفحات 0119');
  const suggestions = (
    await json(await fetch(`${base}/api/customers/suggestions?q=${encodeURIComponent('صفحات 0119')}`, { headers }))
  ).data;
  assert.equal(suggestions.items[0].name, 'عميل صفحات 0119');
  const today = (await json(await fetch(`${base}/api/customers?limit=100&filter=today`, { headers }))).data;
  assert.equal(today.totalItems, 120);
  const healthy = (await json(await fetch(`${base}/api/operations/health`, { headers }))).data;
  assert.equal(healthy.financialMismatches, 0);
  database.prepare('UPDATE customers SET current_balance_units=999 WHERE name=?').run('عميل صفحات 0119');
  const mismatched = (await json(await fetch(`${base}/api/operations/health`, { headers }))).data;
  assert.equal(mismatched.financialMismatches, 1);
});

test('permanent customer ledger edits in place and keeps sequence through cancellation, hiding, and pinning', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', displayName: 'مدير السجل', password: 'Local Admin 123!' }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'admin', password: 'Local Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const created = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'permanent-customer-1',
      name: 'عميل السجل الدائم',
      phone: '0911111111',
      openingBalance: 0,
    }),
  });
  assert.equal(created.status, 201);
  const customer = (await json(created)).data.customer;

  const debt = await fetch(`${base}/api/customers/${customer.id}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'permanent-debt-1',
      expectedVersion: customer.version,
      type: 'debt',
      inputValue: 10,
      calculationMode: 'direct',
      date: new Date().toISOString(),
    }),
  });
  assert.equal(debt.status, 201);
  const debtBody = await json(debt);
  assert.equal(debtBody.data.transaction.sequence, 1);
  assert.equal(debtBody.data.balanceUnits, 10);

  const corrected = await fetch(
    `${base}/api/customers/${customer.id}/transactions/${debtBody.data.transaction.id}/corrections`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'permanent-correct-1',
        expectedVersion: debtBody.data.customerVersion,
        type: 'debt',
        inputValue: 10,
        calculationMode: 'multiply',
        factor: 3,
        date: new Date().toISOString(),
      }),
    },
  );
  assert.equal(corrected.status, 200);
  const correctedBody = await json(corrected);
  assert.equal(correctedBody.data.transaction.id, debtBody.data.transaction.id);
  assert.equal(correctedBody.data.transaction.sequence, 1);
  assert.equal(correctedBody.data.balanceUnits, 30);

  const cancelled = await fetch(
    `${base}/api/customers/${customer.id}/transactions/${correctedBody.data.transaction.id}/cancel`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'permanent-cancel-1',
        expectedVersion: correctedBody.data.customerVersion,
      }),
    },
  );
  assert.equal(cancelled.status, 200);
  const cancelledBody = await json(cancelled);
  assert.equal(cancelledBody.data.balanceUnits, 0);

  const ledger = await json(await fetch(`${base}/api/customers/${customer.id}/ledger`, { headers }));
  assert.equal(ledger.data.customer.nextSequence, 2);
  assert.deepEqual(
    ledger.data.items.map((item: any) => [item.sequence, item.status]),
    [[1, 'reversed']],
  );

  database
    .prepare('UPDATE customers SET inactive_since = ? WHERE id = ?')
    .run(new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString(), customer.id);
  const hiddenList = await json(await fetch(`${base}/api/customers`, { headers }));
  assert.equal(hiddenList.data.items[0].hiddenFromDefault, false);
  assert.equal(hiddenList.data.items[0].zeroReview.pending, true);
  const reviewed = await fetch(`${base}/api/customers/${customer.id}/zero-review`, {
    method: 'POST', headers,
    body: JSON.stringify({ expectedFinancialVersion: hiddenList.data.items[0].zeroReview.financialVersion }),
  });
  assert.equal(reviewed.status, 200);
  const afterReview = await json(await fetch(`${base}/api/customers`, { headers }));
  assert.equal(afterReview.data.items[0].hiddenFromDefault, true);

  const pinned = await fetch(`${base}/api/customers/${customer.id}/pin`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedVersion: cancelledBody.data.customerVersion, isPinned: true }),
  });
  assert.equal(pinned.status, 200);
  const pinnedBody = await json(pinned);
  const pinnedList = await json(await fetch(`${base}/api/customers`, { headers }));
  assert.equal(pinnedList.data.items[0].isPinned, true);
  assert.equal(pinnedList.data.items[0].hiddenFromDefault, false);

  const updated = await fetch(`${base}/api/customers/${customer.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      expectedVersion: pinnedBody.data.customerVersion,
      name: 'عميل السجل المحدّث',
      phone: '0911111111',
    }),
  });
  assert.equal(updated.status, 200);
  const updatedLedger = await json(await fetch(`${base}/api/customers/${customer.id}/ledger`, { headers }));
  assert.equal(updatedLedger.data.customer.name, 'عميل السجل المحدّث');

  const duplicate = await fetch(`${base}/api/customers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'permanent-duplicate-1',
      name: 'اسم آخر',
      phone: '0911111111',
      openingBalance: 0,
    }),
  });
  assert.equal(duplicate.status, 409);
  const duplicateBody = await json(duplicate);
  assert.equal(duplicateBody.error.code, 'CUSTOMER_ALREADY_EXISTS');
  assert.equal(duplicateBody.error.details.customerId, customer.id);
});

test('internet gate accepts one verified public response and rejects two failures', async () => {
  const config = {
    internetRequired: true,
    internetProbeUrls: [
      'http://www.msftconnecttest.com/connecttest.txt',
      'https://www.google.com/generate_204',
    ],
    internetProbeTimeoutMs: 100,
    internetProbeCacheMs: 1,
  };
  const oneSuccess = new InternetGate(config, (async (input: string | URL | Request) => {
    return String(input).includes('generate_204')
      ? new Response(null, { status: 204 })
      : new Response('unexpected', { status: 200 });
  }) as typeof fetch);
  assert.equal(await oneSuccess.isAvailable(), true);

  const noSuccess = new InternetGate(
    config,
    (async () => new Response('portal', { status: 200 })) as typeof fetch,
  );
  assert.equal(await noSuccess.isAvailable(), false);

  const firstSuccessWins = new InternetGate(config, (async (input: string | URL | Request) => {
    if (String(input).includes('msftconnecttest')) return new Promise<Response>(() => {});
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  const fastResult = await Promise.race([
    firstSuccessWins.isAvailable(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(fastResult, true);

  const oversizedPortal = new InternetGate(
    {
      ...config,
      internetProbeUrls: ['http://www.msftconnecttest.com/connecttest.txt'],
    },
    (async () => new Response('Microsoft Connect Test'.padEnd(256, '!'), { status: 200 })) as typeof fetch,
  );
  assert.equal(await oversizedPortal.isAvailable(), false);
});

test('collector overpayment stays pending until admin approval then becomes customer credit', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'collection-admin',
      displayName: 'مدير التحصيل',
      password: 'Collection Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'collection-admin', password: 'Collection Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const created = await json(
    await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'collection-customer',
        name: 'عميل التحصيل',
        phone: '0910000000',
        openingBalance: 1000,
      }),
    }),
  );
  const customerId = created.data.customer.id;
  const employee = await json(
    await fetch(`${base}/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'alsaghir',
        displayName: 'الصغير',
        password: 'Small Collector 123!',
        permissions: ['collections.read', 'collections.write'],
        customerDebtsAccess: 'none',
        companyDebtsAccess: 'none',
        libyanDepositsAccess: 'none',
        egyptianDepositsAccess: 'none',
      }),
    }),
  );
  const employeeId = employee.data.user.id;
  const zeroCustomer = await json(
    await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: 'zero-collection-customer', name: 'عميل صفر', openingBalance: 0 }),
    }),
  );
  const zeroAssignment = await fetch(`${base}/api/collections/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerIds: [zeroCustomer.data.customer.id],
      assigneeUserId: employeeId,
      section: 'customers',
    }),
  });
  assert.equal(zeroAssignment.status, 409);
  const assignment = await json(
    await fetch(`${base}/api/collections/assignments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ customerIds: [customerId], assigneeUserId: employeeId }),
    }),
  );
  const assignmentId = assignment.data.assignmentIds[0];
  let customerSnapshotBody = await json(await fetch(`${base}/api/customers/${customerId}`, { headers }));
  assert.equal(customerSnapshotBody.data.activeAssigneeName, 'الصغير');
  database.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(employeeId);
  const employeeLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'alsaghir', password: 'Small Collector 123!' }),
  });
  const employeeLoginBody = await json(employeeLogin);
  const employeeHeaders = {
    'content-type': 'application/json',
    cookie: employeeLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(employeeLoginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const employeeEvents = await fetch(`${base}/api/event-changes?after=0`, { headers: employeeHeaders });
  assert.equal(employeeEvents.status, 200);
  const employeeEventBody = await json(employeeEvents);
  assert.equal(
    employeeEventBody.data.events.some(
      (event: Record<string, unknown>) => event.topic === 'collection.changed',
    ),
    true,
  );
  const submitted = await fetch(`${base}/api/collections/assignments/${assignmentId}/submissions`, {
    method: 'POST',
    headers: employeeHeaders,
    body: JSON.stringify({ mode: 'partial', amountUnits: 2000 }),
  });
  assert.equal(submitted.status, 201);
  const submittedBody = await json(submitted);
  const notifications = await json(await fetch(`${base}/api/notifications`, { headers }));
  const collectionNotice = notifications.data.items.find(
    (item: Record<string, unknown>) => item.action === 'collection.submit',
  );
  assert.equal(collectionNotice.actorName, 'الصغير');
  assert.equal(collectionNotice.details.subjectName, 'عميل التحصيل');
  assert.equal(collectionNotice.details.subjectSection, 'customer_debts');
  assert.equal(collectionNotice.details.paymentMode, 'partial');
  assert.equal(collectionNotice.details.amountUnits, 2000);
  let ledger = await json(await fetch(`${base}/api/customers/${customerId}/ledger`, { headers }));
  assert.equal(ledger.data.customer.balanceUnits, 1000);
  const approved = await json(
    await fetch(`${base}/api/collections/submissions/${submittedBody.data.id}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'approve' }),
    }),
  );
  assert.equal(approved.data.balanceUnits, -1000);
  const notificationsAfterApproval = await json(await fetch(`${base}/api/notifications`, { headers }));
  assert.equal(
    notificationsAfterApproval.data.items.filter(
      (item: Record<string, unknown>) => item.action === 'customer.payment',
    ).length,
    0,
  );
  ledger = await json(await fetch(`${base}/api/customers/${customerId}/ledger`, { headers }));
  assert.equal(ledger.data.customer.balanceUnits, -1000);
  assert.equal(ledger.data.items[1].actorName, 'الصغير');
  let dashboard = await json(await fetch(`${base}/api/collections`, { headers }));
  assert.equal(dashboard.data.assignments.length, 1);
  assert.equal(dashboard.data.assignments[0].balanceUnits, -1000);
  const batchId = dashboard.data.assignments[0].batchId;
  const blockedClose = await fetch(`${base}/api/collections/days/close`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ batchId, confirmed: true }),
  });
  assert.equal(blockedClose.status, 409);
  await fetch(`${base}/api/collections/submissions/${submittedBody.data.id}/cash-received`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const closed = await fetch(`${base}/api/collections/days/close`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ batchId, confirmed: true }),
  });
  assert.equal(closed.status, 200);
  customerSnapshotBody = await json(await fetch(`${base}/api/customers/${customerId}`, { headers }));
  assert.equal(customerSnapshotBody.data.activeAssigneeName, null);
  dashboard = await json(await fetch(`${base}/api/collections`, { headers }));
  assert.equal(dashboard.data.assignments.length, 0);
  assert.equal(dashboard.data.submissions.length, 0);
  ledger = await json(await fetch(`${base}/api/customers/${customerId}/ledger`, { headers }));
  assert.equal(ledger.data.customer.balanceUnits, -1000);
  const creditAssignment = await fetch(`${base}/api/collections/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerIds: [customerId], assigneeUserId: employeeId, section: 'customers' }),
  });
  assert.equal(creditAssignment.status, 409);
  const newDebt = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'collection-new-debt',
      expectedVersion: 2,
      type: 'debt',
      inputValue: 2000,
      calculationMode: 'direct',
      date: new Date().toISOString(),
    }),
  });
  assert.equal(newDebt.status, 201);
  const reassigned = await fetch(`${base}/api/collections/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerIds: [customerId], assigneeUserId: employeeId, section: 'customers' }),
  });
  assert.equal(reassigned.status, 201);
  customerSnapshotBody = await json(await fetch(`${base}/api/customers/${customerId}`, { headers }));
  assert.equal(customerSnapshotBody.data.activeAssigneeName, 'الصغير');
  dashboard = await json(await fetch(`${base}/api/collections`, { headers }));
  assert.equal(dashboard.data.assignments.length, 1);
  assert.notEqual(dashboard.data.assignments[0].batchId, batchId);

  const companyCreated = await json(
    await fetch(`${base}/api/companies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: 'collection-company', name: 'شركة التحصيل', openingBalance: 500 }),
    }),
  );
  const companyId = companyCreated.data.customer.id;
  const companyAssignment = await json(
    await fetch(`${base}/api/collections/assignments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ customerIds: [companyId], assigneeUserId: employeeId, section: 'companies' }),
    }),
  );
  assert.equal(companyAssignment.ok, true);
  customerSnapshotBody = await json(await fetch(`${base}/api/companies/${companyId}`, { headers }));
  assert.equal(customerSnapshotBody.data.activeAssigneeName, 'الصغير');
  const companySubmitted = await json(
    await fetch(
      `${base}/api/collections/assignments/${companyAssignment.data.assignmentIds[0]}/submissions`,
      { method: 'POST', headers, body: JSON.stringify({ mode: 'partial', amountUnits: 200 }) },
    ),
  );
  const companyApproved = await fetch(
    `${base}/api/collections/submissions/${companySubmitted.data.id}/decision`,
    { method: 'POST', headers, body: JSON.stringify({ decision: 'approve' }) },
  );
  assert.equal(companyApproved.status, 200);
  const companyLedger = await json(await fetch(`${base}/api/companies/${companyId}/ledger`, { headers }));
  assert.equal(companyLedger.data.customer.balanceUnits, 300);
  assert.equal(companyLedger.data.items.at(-1).actorName, 'الصغير');
});

test('collection cards and full receipt use the calculated customer balance', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'calculated-admin',
      displayName: 'مدير محسوب',
      password: 'Calculated Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'calculated-admin', password: 'Calculated Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const customer = await json(
    await fetch(`${base}/api/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: 'calculated-collection-customer',
        name: 'عميل محسوب',
        openingBalance: 0,
      }),
    }),
  );
  const customerId = String(customer.data.customer.id);
  const debt = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'calculated-collection-debt',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 100,
      calculationMode: 'multiply',
      factor: 3,
    }),
  });
  assert.equal(debt.status, 201);
  const employee = await json(
    await fetch(`${base}/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'calculated-collector',
        displayName: 'موظف محسوب',
        password: 'Calculated Collector 123!',
        permissions: ['collections.read', 'collections.write'],
        customerDebtsAccess: 'none',
        companyDebtsAccess: 'none',
        libyanDepositsAccess: 'none',
        egyptianDepositsAccess: 'none',
      }),
    }),
  );
  const oversizedAssignment = await fetch(`${base}/api/collections/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      customerIds: Array.from({ length: 501 }, (_, index) => `customer-${index}`),
      assigneeUserId: employee.data.user.id,
    }),
  });
  assert.equal(oversizedAssignment.status, 400);
  const assignment = await json(
    await fetch(`${base}/api/collections/assignments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ customerIds: [customerId], assigneeUserId: employee.data.user.id }),
    }),
  );
  const assignmentId = String(assignment.data.assignmentIds[0]);
  database.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(employee.data.user.id);
  const employeeLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'calculated-collector', password: 'Calculated Collector 123!' }),
  });
  const employeeHeaders = {
    cookie: employeeLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-client-api-version': '1',
  };
  const beforeEvents = await json(
    await fetch(`${base}/api/event-changes?after=0`, { headers: employeeHeaders }),
  );
  const after = Number(beforeEvents.data.latest);
  const addedDebt = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'calculated-collection-second-debt',
      expectedVersion: 2,
      type: 'debt',
      inputValue: 100,
      calculationMode: 'direct',
    }),
  });
  assert.equal(addedDebt.status, 201);
  const employeeChanges = await json(
    await fetch(`${base}/api/event-changes?after=${after}`, { headers: employeeHeaders }),
  );
  assert.equal(
    employeeChanges.data.events.some(
      (event: Record<string, unknown>) =>
        event.topic === 'customer.ledger.changed' && event.aggregateId === customerId,
    ),
    true,
    JSON.stringify(employeeChanges.data),
  );
  const dashboard = await json(await fetch(`${base}/api/collections`, { headers }));
  assert.equal(dashboard.data.assignments[0].balanceUnits, 400);
  const unsafePartial = await fetch(`${base}/api/collections/assignments/${assignmentId}/submissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'partial', amountUnits: Number.MAX_SAFE_INTEGER }),
  });
  assert.equal(unsafePartial.status, 400);
  const submitted = await json(
    await fetch(`${base}/api/collections/assignments/${assignmentId}/submissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'full' }),
    }),
  );
  assert.equal(submitted.data.amountUnits, 400);
  const duplicatePending = await fetch(`${base}/api/collections/assignments/${assignmentId}/submissions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'full' }),
  });
  assert.equal(duplicatePending.status, 409);
});

test('organization boundary isolates every permanent account section and blocks foreign mutations', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') });
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'tenant-admin',
      displayName: 'مدير المؤسسة',
      password: 'Tenant Admin 123!',
    }),
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'tenant-admin', password: 'Tenant Admin 123!' }),
  });
  const loginBody = await json(login);
  const headers = {
    'content-type': 'application/json',
    cookie: login.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(loginBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const create = async (path: string, requestId: string, name: string) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId, name, openingBalance: 1000 }),
    });
    assert.equal(response.status, 201);
    return await json(response);
  };
  const customer = await create('/api/customers', 'tenant-one-customer', 'عميل المؤسسة الأولى');
  await create('/api/companies', 'tenant-one-company', 'شركة المؤسسة الأولى');
  await create('/api/libyan-deposits', 'tenant-one-lyd', 'أمانة ليبية أولى');
  await create('/api/egyptian-deposits', 'tenant-one-egp', 'أمانة مصرية أولى');
  const customerId = String(customer.data.customer.id);
  const firstEmployeeResponse = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: 'tenant-one-collector',
      displayName: 'محصل المؤسسة الأولى',
      password: 'Tenant Collector One 123!',
      permissions: ['collections.read', 'collections.write'],
    }),
  });
  assert.equal(firstEmployeeResponse.status, 201);
  const firstEmployee = await json(firstEmployeeResponse);
  const firstMasraweya = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-10-01',
      expectedVersion: 0,
      previousValueUnits: 111,
      purchasesUnits: 0,
      entries: [],
    }),
  });
  assert.equal(firstMasraweya.status, 200);
  const firstRate = await fetch(`${base}/api/egyptian-deposits/exchange-rate`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ egpPerLyd: 17.25 }),
  });
  assert.equal(firstRate.status, 200);

  const now = new Date().toISOString();
  const firstAccountRequestId = 'request-org-default';
  database
    .prepare(
      `
    INSERT INTO account_requests(
      id,organization_id,provider,provider_subject,email,display_name,status,requested_at
    ) VALUES (?, 'org-default', 'google', 'google-org-default', 'first@example.test',
      'طلب المؤسسة الأولى', 'pending', ?)
  `,
    )
    .run(firstAccountRequestId, now);
  database
    .prepare(
      `
    INSERT INTO organizations(id, name, slug, created_at, updated_at)
    VALUES ('org-secondary', 'المؤسسة الثانية', 'secondary', ?, ?)
  `,
    )
    .run(now, now);
  database
    .prepare(
      `
    INSERT INTO branches(id, organization_id, code, name, created_at, updated_at)
    VALUES ('branch-secondary', 'org-secondary', 'MAIN', 'الفرع الثاني', ?, ?)
  `,
    )
    .run(now, now);
  database
    .prepare(
      `
    UPDATE users SET organization_id = 'org-secondary', home_branch_id = 'branch-secondary'
    WHERE username = 'tenant-admin'
  `,
    )
    .run();

  for (const path of ['/api/customers', '/api/companies', '/api/libyan-deposits', '/api/egyptian-deposits']) {
    const response = await fetch(`${base}${path}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(
      (await json(response)).data.items.length,
      0,
      `${path} leaked cards from another organization`,
    );
  }
  const isolatedEvents = await json(await fetch(`${base}/api/event-changes?after=0`, { headers }));
  assert.equal(isolatedEvents.data.events.length, 0, 'realtime feed leaked events from another organization');
  const isolatedMasraweya = await json(await fetch(`${base}/api/masraweya/day?date=2026-10-01`, { headers }));
  assert.equal(isolatedMasraweya.data.previousValueUnits, 0);
  assert.equal(isolatedMasraweya.data.version, 0);
  const isolatedRate = await json(await fetch(`${base}/api/egyptian-deposits/exchange-rate`, { headers }));
  assert.equal(isolatedRate.data.egpPerLyd, null);
  const isolatedRequests = await json(await fetch(`${base}/api/account-requests`, { headers }));
  assert.equal(isolatedRequests.data.items.length, 0);
  const secondAccountRequestId = 'request-org-secondary';
  database
    .prepare(
      `
    INSERT INTO account_requests(
      id,organization_id,provider,provider_subject,email,display_name,status,requested_at
    ) VALUES (?, 'org-secondary', 'google', 'google-org-secondary', 'second@example.test',
      'طلب المؤسسة الثانية', 'pending', ?)
  `,
    )
    .run(secondAccountRequestId, now);
  const scopedRequests = await json(await fetch(`${base}/api/account-requests`, { headers }));
  assert.deepEqual(
    scopedRequests.data.items.map((item: Record<string, unknown>) => item.id),
    [secondAccountRequestId],
  );
  const foreignDecision = await fetch(`${base}/api/account-requests/${firstAccountRequestId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'reject', expectedVersion: 1, customerDebtsAccess: 'none' }),
  });
  assert.equal(foreignDecision.status, 404);
  const ownDecision = await fetch(`${base}/api/account-requests/${secondAccountRequestId}/decision`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'approve', expectedVersion: 1, customerDebtsAccess: 'none' }),
  });
  assert.equal(ownDecision.status, 200);
  const approvedGoogleUser = database
    .prepare(
      `
    SELECT organization_id,home_branch_id FROM users WHERE email='second@example.test'
  `,
    )
    .get() as { organization_id: string; home_branch_id: string };
  assert.equal(approvedGoogleUser.organization_id, 'org-secondary');
  assert.equal(approvedGoogleUser.home_branch_id, 'branch-secondary');
  assert.equal((await fetch(`${base}/api/customers/${customerId}`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/customers/${customerId}/ledger`, { headers })).status, 404);
  const foreignWrite = await fetch(`${base}/api/customers/${customerId}/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'tenant-foreign-write',
      expectedVersion: 1,
      type: 'debt',
      inputValue: 100,
      calculationMode: 'direct',
      date: now,
    }),
  });
  assert.equal(foreignWrite.status, 404);

  const secondCustomer = await create('/api/customers', 'tenant-two-customer', 'عميل المؤسسة الثانية');
  const secondId = String(secondCustomer.data.customer.id);
  const secondList = await json(await fetch(`${base}/api/customers`, { headers }));
  assert.deepEqual(
    secondList.data.items.map((item: Record<string, unknown>) => item.id),
    [secondId],
  );
  const secondEvents = await json(await fetch(`${base}/api/event-changes?after=0`, { headers }));
  assert.equal(
    secondEvents.data.events.some((event: Record<string, unknown>) => event.aggregateId === customerId),
    false,
  );
  assert.equal(
    secondEvents.data.events.some((event: Record<string, unknown>) => event.aggregateId === secondId),
    true,
  );
  const stored = database.prepare('SELECT organization_id FROM customers WHERE id = ?').get(secondId) as {
    organization_id: string;
  };
  assert.equal(stored.organization_id, 'org-secondary');

  const secondEmployeeResponse = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: 'tenant-two-collector',
      displayName: 'محصل المؤسسة الثانية',
      password: 'Tenant Collector Two 123!',
      permissions: ['collections.read', 'collections.write'],
    }),
  });
  assert.equal(secondEmployeeResponse.status, 201);
  const secondEmployee = await json(secondEmployeeResponse);
  assert.throws(
    () =>
      database
        .prepare("UPDATE users SET home_branch_id='branch-main' WHERE id=?")
        .run(secondEmployee.data.user.id),
    /organization_branch_mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `
      INSERT INTO treasury_transactions(
        id,direction,amount_units,currency,conversion_rate_micros,transaction_date,
        reference_no,source,source_id,description,actor_user_id,branch_id,created_at,updated_at
      ) VALUES(
        'cross-org-treasury','in',1,'LYD',1000000,'2026-10-01',
        'TEST-CROSS','manual_deposit',NULL,'اختبار',?,'branch-main',?,?
      )
    `,
        )
        .run(secondEmployee.data.user.id, now, now),
    /treasury_transaction_organization_mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare("UPDATE debt_transactions SET branch_id='branch-main' WHERE customer_id=?")
        .run(secondId),
    /debt_transaction_organization_mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `
      INSERT INTO debt_assignments(
        id,customer_id,assignee_user_id,assigned_by_user_id,status,assigned_at,business_date
      ) VALUES('cross-org-assignment',?,?,?,'active',?,'2026-10-01')
    `,
        )
        .run(customerId, secondEmployee.data.user.id, loginBody.data.user.id, now),
    /debt_assignment_organization_mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `
      INSERT INTO audit_log(
        actor_user_id,organization_id,action,entity_type,entity_id,
        correlation_id,outcome,details_json,created_at
      ) VALUES(?,'org-default','test.cross_org','test','cross-org-audit',
        'cross-org-audit','success','{}',?)
    `,
        )
        .run(secondEmployee.data.user.id, now),
    /audit_log_organization_mismatch/,
  );
  const users = await json(await fetch(`${base}/api/users`, { headers }));
  assert.equal(
    users.data.items.some((item: Record<string, unknown>) => item.id === firstEmployee.data.user.id),
    false,
  );
  assert.equal(
    users.data.items.some((item: Record<string, unknown>) => item.id === secondEmployee.data.user.id),
    true,
  );
  const assignees = await json(await fetch(`${base}/api/collections/assignees`, { headers }));
  assert.deepEqual(
    assignees.data.items.map((item: Record<string, unknown>) => item.id),
    [secondEmployee.data.user.id],
  );
  const foreignAssignment = await fetch(`${base}/api/collections/assignments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerIds: [customerId], assigneeUserId: secondEmployee.data.user.id }),
  });
  assert.equal(foreignAssignment.status, 404);
  const secondMasraweya = await fetch(`${base}/api/masraweya/day`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      businessDate: '2026-10-01',
      expectedVersion: 0,
      previousValueUnits: 222,
      purchasesUnits: 0,
      entries: [],
    }),
  });
  assert.equal(secondMasraweya.status, 200);
  const secondRate = await fetch(`${base}/api/egyptian-deposits/exchange-rate`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ egpPerLyd: 18.5 }),
  });
  assert.equal(secondRate.status, 200);
  const tenantRows = database
    .prepare(
      `
    SELECT organization_id, previous_value_units FROM masraweya_days
    WHERE business_date='2026-10-01' ORDER BY organization_id
  `,
    )
    .all() as Array<{ organization_id: string; previous_value_units: number }>;
  assert.deepEqual(
    tenantRows.map((row) => ({ ...row })),
    [
      { organization_id: 'org-default', previous_value_units: 111 },
      { organization_id: 'org-secondary', previous_value_units: 222 },
    ],
  );
  const rateRows = database
    .prepare(
      `
    SELECT organization_id, source_units_per_target_micros FROM section_exchange_rates
    WHERE section_key='egyptian_deposits' ORDER BY organization_id
  `,
    )
    .all() as Array<{ organization_id: string; source_units_per_target_micros: number }>;
  assert.deepEqual(
    rateRows.map((row) => ({ ...row })),
    [
      { organization_id: 'org-default', source_units_per_target_micros: 17_250_000 },
      { organization_id: 'org-secondary', source_units_per_target_micros: 18_500_000 },
    ],
  );
  const customerAudits = database
    .prepare(
      `
    SELECT entity_id,organization_id FROM audit_log
    WHERE action='customer.create' AND entity_id IN (?,?) ORDER BY entity_id
  `,
    )
    .all(customerId, secondId) as Array<{ entity_id: string; organization_id: string }>;
  assert.deepEqual(
    new Map(customerAudits.map((row) => [row.entity_id, row.organization_id])),
    new Map([
      [customerId, 'org-default'],
      [secondId, 'org-secondary'],
    ]),
  );
  const secondaryPurchases = await json(await fetch(`${base}/api/purchases/al_bayan`, { headers }));
  const secondaryPurchase = await fetch(`${base}/api/purchases/al_bayan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: 'tenant-two-purchase',
      expectedDayVersion: secondaryPurchases.data.day.version,
      itemCode: 'cairo',
      itemLabel: 'القاهرة',
      egpValueUnits: 100,
      calculationMode: 'multiply',
      exchangeRate: '1',
      paidUnits: 0,
      vodafoneConsumedUnits: 0,
    }),
  });
  assert.equal(secondaryPurchase.status, 201);
  const secondaryPurchaseRows = database
    .prepare(
      `
    SELECT d.id AS day_id,e.id AS entry_id FROM purchase_days d
    JOIN purchase_entries e ON e.day_id=d.id
    WHERE d.organization_id='org-secondary' LIMIT 1
  `,
    )
    .get() as { day_id: string; entry_id: string };
  assert.throws(
    () =>
      database
        .prepare('UPDATE purchase_days SET correction_opened_by_user_id=? WHERE id=?')
        .run(firstEmployee.data.user.id, secondaryPurchaseRows.day_id),
    /purchase_day_organization_mismatch/,
  );
  assert.throws(
    () =>
      database
        .prepare('UPDATE purchase_entries SET actor_user_id=? WHERE id=?')
        .run(firstEmployee.data.user.id, secondaryPurchaseRows.entry_id),
    /purchase_entry_organization_mismatch/,
  );
  database.prepare("UPDATE organizations SET status='suspended' WHERE id='org-secondary'").run();
  assert.throws(
    () => createSession(database, String(loginBody.data.user.id), '1', 12),
    (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401),
  );
  assert.equal((await fetch(`${base}/api/me`, { headers })).status, 401);
  const suspendedLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'tenant-admin', password: 'Tenant Admin 123!' }),
  });
  assert.equal(suspendedLogin.status, 401);
  database.prepare("UPDATE organizations SET status='active' WHERE id='org-secondary'").run();
  database.prepare("UPDATE branches SET is_active=0 WHERE id='branch-secondary'").run();
  assert.throws(
    () => createSession(database, String(loginBody.data.user.id), '1', 12),
    (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401),
  );
  assert.equal((await fetch(`${base}/api/me`, { headers })).status, 401);
  const inactiveBranchLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'tenant-admin', password: 'Tenant Admin 123!' }),
  });
  assert.equal(inactiveBranchLogin.status, 401);
});

test('server closes requests silently when the internet check fails', async () => {
  const database = temporaryDatabase();
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    sessionHours: 12,
    secureCookie: false,
    internetRequired: true,
    internetProbeUrls: [],
    internetProbeTimeoutMs: 100,
    internetProbeCacheMs: 100,
  };
  const server = createApp(database, config, { internetCheck: async () => false });
  await listen(server, config.host, 0);
  cleanups.push(() => server.close());
  const address = server.address() as AddressInfo;
  await assert.rejects(fetch(`http://127.0.0.1:${address.port}/api/health`));
});

test('four employees work concurrently while section permissions stay isolated', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'team-admin', displayName: 'مدير الفريق', password: 'Team Admin 123!' }),
  });
  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'team-admin', password: 'Team Admin 123!' }),
  });
  const adminSession = await json(adminLogin);
  const adminHeaders = {
    'content-type': 'application/json',
    cookie: adminLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(adminSession.data.csrfToken),
    'x-client-api-version': '1',
  };
  const definitions = [
    { username: 'team-customer-1', password: 'Customer One 123!', permissions: ['debts.read', 'debts.write'], allowed: '/api/customers', denied: '/api/companies' },
    { username: 'team-customer-2', password: 'Customer Two 123!', permissions: ['debts.read', 'debts.write'], allowed: '/api/customers', denied: '/api/reports' },
    { username: 'team-company', password: 'Company Team 123!', permissions: ['companies.read', 'companies.write'], allowed: '/api/companies', denied: '/api/customers' },
    { username: 'team-reports', password: 'Reports Team 123!', permissions: ['reports.read'], allowed: '/api/reports', denied: '/api/customers' },
  ];
  for (const definition of definitions) {
    const response = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        username: definition.username,
        displayName: definition.username,
        password: definition.password,
        permissions: definition.permissions,
      }),
    });
    assert.equal(response.status, 201);
  }
  database.prepare(`UPDATE users SET must_change_password=0 WHERE username LIKE 'team-%' AND role='employee'`).run();

  const sessions = await Promise.all(definitions.map(async (definition) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
      body: JSON.stringify({ username: definition.username, password: definition.password }),
    });
    assert.equal(response.status, 200);
    const body = await json(response);
    return {
      ...definition,
      headers: {
        'content-type': 'application/json',
        cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
        'x-csrf-token': String(body.data.csrfToken),
        'x-client-api-version': '1',
      },
    };
  }));

  const accessResults = await Promise.all(sessions.flatMap((session) => [
    fetch(`${base}${session.allowed}`, { headers: { cookie: session.headers.cookie } }),
    fetch(`${base}${session.denied}`, { headers: { cookie: session.headers.cookie } }),
  ]));
  for (let index = 0; index < accessResults.length; index += 2) {
    assert.equal(accessResults[index]?.status, 200);
    assert.equal(accessResults[index + 1]?.status, 403);
  }

  const writes = await Promise.all(sessions.slice(0, 3).map((session, index) => fetch(
    `${base}${session.allowed}`,
    {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({
        requestId: `four-employee-concurrent-${index}`,
        name: `حساب متزامن ${index + 1}`,
        openingBalance: 100 + index,
      }),
    },
  )));
  assert.deepEqual(writes.map((response) => response.status), [201, 201, 201]);
  assert.equal(
    Number((database.prepare(`
      SELECT COUNT(*) AS count FROM customers
      WHERE name LIKE 'حساب متزامن %' AND deleted_at IS NULL
    `).get() as { count: number }).count),
    3,
  );
});

test('protected owner is unique and only the owner can manage general administrators', async () => {
  const database = temporaryDatabase();
  const base = await startApi(database);
  await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'system-owner',
      displayName: 'المالك الرئيسي',
      password: 'Owner Account 123!',
    }),
  });
  const ownerLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'system-owner', password: 'Owner Account 123!' }),
  });
  const ownerBody = await json(ownerLogin);
  assert.equal(ownerBody.data.user.isOwner, true);
  const ownerHeaders = {
    'content-type': 'application/json',
    cookie: ownerLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(ownerBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  const adminCreatedResponse = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      username: 'general-admin',
      displayName: 'إداري عام',
      email: 'general.admin@example.com',
      role: 'admin',
      password: 'General Admin 123!',
    }),
  });
  assert.equal(adminCreatedResponse.status, 201);
  const generalAdmin = (await json(adminCreatedResponse)).data.user;
  assert.equal(generalAdmin.role, 'admin');
  assert.equal(generalAdmin.isOwner, false);

  const generalLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'general-admin', password: 'General Admin 123!' }),
  });
  const generalBody = await json(generalLogin);
  const generalHeaders = {
    'content-type': 'application/json',
    cookie: generalLogin.headers.get('set-cookie')?.split(';')[0] ?? '',
    'x-csrf-token': String(generalBody.data.csrfToken),
    'x-client-api-version': '1',
  };
  await fetch(`${base}/api/auth/change-password`, {
    method: 'POST',
    headers: generalHeaders,
    body: JSON.stringify({
      currentPassword: 'General Admin 123!',
      newPassword: 'General Personal 456!',
    }),
  });
  const employeeCreated = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: generalHeaders,
    body: JSON.stringify({
      username: 'general-created-employee',
      displayName: 'موظف أنشأه الإداري',
      role: 'employee',
      password: 'Employee Account 123!',
      customerDebtsAccess: 'manage',
    }),
  });
  assert.equal(employeeCreated.status, 201);
  const forbiddenAdmin = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: generalHeaders,
    body: JSON.stringify({
      username: 'forbidden-admin',
      displayName: 'إداري غير مصرح',
      email: 'forbidden.admin@example.com',
      role: 'admin',
      password: 'Forbidden Admin 123!',
    }),
  });
  assert.equal(forbiddenAdmin.status, 403);

  const owner = database.prepare("SELECT id, version FROM users WHERE is_owner = 1").get() as {
    id: string;
    version: number;
  };
  const ownerProtection = await fetch(`${base}/api/users/${owner.id}`, {
    method: 'PATCH',
    headers: generalHeaders,
    body: JSON.stringify({
      expectedVersion: owner.version,
      displayName: 'محاولة تعديل المالك',
      isActive: false,
    }),
  });
  assert.equal(ownerProtection.status, 409);
  assert.equal(
    Number((database.prepare('SELECT COUNT(*) AS count FROM users WHERE is_owner = 1').get() as { count: number }).count),
    1,
  );
  const operationsHealth = await fetch(`${base}/api/operations/health`, {
    headers: { cookie: ownerHeaders.cookie },
  });
  assert.equal(operationsHealth.status, 200);
  assert.equal((await json(operationsHealth)).data.integrity, 'ok');
  const sessionsResponse = await fetch(`${base}/api/operations/sessions`, {
    headers: { cookie: ownerHeaders.cookie },
  });
  const sessions = (await json(sessionsResponse)).data.items;
  const generalSession = sessions.find((session: any) => session.username === 'general-admin' && session.active);
  assert.ok(generalSession);
  const revoked = await fetch(`${base}/api/operations/sessions/${encodeURIComponent(generalSession.id)}/revoke`, {
    method: 'POST',
    headers: ownerHeaders,
  });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: generalHeaders.cookie } })).status, 401);
});
