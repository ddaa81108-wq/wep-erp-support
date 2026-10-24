import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { reportActivity, reportOverview, reportSourceDetails } from '../src/server/domain/reports/reportOverview.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createCustomer, addCustomerTransaction, cancelCustomerTransaction, correctCustomerTransaction } from '../src/server/domain/customers.ts';
import { treasuryDashboard, addTreasuryCashEntry } from '../src/server/domain/treasury.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import { listPurchases } from '../src/server/domain/purchaseQueries.ts';
import { createPurchaseEntry, deletePurchaseEntry } from '../src/server/domain/purchaseEntryCommands.ts';
import { finalizePurchaseDay, setPurchaseOpening } from '../src/server/domain/purchaseDayCommands.ts';
import { createUnlinkedCollectionReceipt, submitCollection, decideCollection } from '../src/server/domain/collections.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import type { AddressInfo } from 'node:net';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';

const url = (query = '') => new URL('http://localhost/api/reports/activity' + query);
function snapshot(db: ReturnType<typeof openDatabase>) {
  return JSON.stringify(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(row => [row.name, db.prepare(`SELECT * FROM "${String(row.name)}"`).all().map(value => JSON.stringify(value)).sort()]));
}

test('new report can read query-only database without initializing cash or writing any table', () => {
  const db = openDatabase(':memory:');
  try {
    const before = snapshot(db);
    db.exec('PRAGMA query_only=ON');
    const report = reportOverview(db, 'org-default');
    assert.equal(report.position.netUnits, 0);
    assert.equal(report.sources.find(source => source.key === 'cash')!.count, 0);
    assert.equal(reportActivity(db, 'org-default', url()).items.length, 0);
    assert.equal(reportSourceDetails(db, 'org-default', url('?group=cash')).items.length, 0);
    assert.equal(snapshot(db), before);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test('report matches treasury, separates currencies and credits, and uses latest purchase carry once', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const customer = createCustomer(db, actor, { requestId: 'overview-customer', name: 'Overview customer', openingBalance: 1000 }, 'test');
    const customerId = String((customer.body.customer as { id: string }).id);
    for (const [kind, openingBalance] of [['company', 200], ['depositLyd', 300], ['depositEgp', 500]] as const)
      createCustomer(db, actor, { requestId: `overview-${kind}`, name: `Overview ${kind}`, openingBalance }, 'test', kind);
    const missing = reportOverview(db, actor.organizationId);
    assert.equal(missing.position.netUnits, null);
    assert.equal(missing.position.egyptianUnits, 500);
    setEgyptianDepositRate(db, actor, '5');
    let purchase = listPurchases(db, actor, 'al_bayan', null, null);
    setPurchaseOpening(db, actor, 'al_bayan', { expectedDayVersion: purchase.day.version, previousDebtUnits: 100, previousVodafoneUnits: 0 }, 'test');
    purchase = listPurchases(db, actor, 'al_bayan', null, null);
    createPurchaseEntry(db, actor, 'al_bayan', { requestId: 'overview-purchase-one', expectedDayVersion: purchase.day.version,
      itemCode: 'custom', itemLabel: 'Overview purchase', egpValueUnits: 200, calculationMode: 'divide', exchangeRate: '1', paidUnits: 50, vodafoneConsumedUnits: 0 }, 'test');
    purchase = listPurchases(db, actor, 'al_bayan', null, null);
    finalizePurchaseDay(db, actor, 'al_bayan', { requestId: 'overview-finalize', expectedDayVersion: purchase.day.version }, 'test');
    addTreasuryCashEntry(db, actor, { requestId: 'overview-cash-in', expectedVersion: 0, direction: 'in', amountUnits: 70 }, 'test');
    const report = reportOverview(db, actor.organizationId);
    const treasury = treasuryDashboard(db, actor.organizationId);
    assert.equal(report.position.netUnits, treasury.netUnits);
    assert.equal(report.position.netUnits, 820);
    assert.equal(report.sources.find(source => source.key === 'purchases')!.balanceUnits, 250);
    assert.equal(report.daily.purchasesUnits, 200);
    assert.equal(report.daily.purchasePaymentsUnits, 50);
    assert.equal(report.daily.cashInUnits, 70);
    const add = (amount: number, requestId: string) => {
      const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
      return addCustomerTransaction(db, actor, customerId, { requestId, expectedVersion: version, type: 'payment', paymentMode: 'partial', inputValue: amount, date: new Date().toISOString() }, 'test');
    };
    add(200, 'overview-partial-one');
    assert.equal(reportOverview(db, actor.organizationId).position.receivablesUnits, 1000);
    const second = add(800, 'overview-final-payment');
    assert.equal(reportOverview(db, actor.organizationId).position.receivablesUnits, 200);
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
    cancelCustomerTransaction(db, actor, customerId, String((second.body.transaction as { id: string }).id), { requestId: 'overview-cancel-payment', expectedVersion: version }, 'test');
    assert.equal(reportOverview(db, actor.organizationId).position.receivablesUnits, 1000);
    const entry = listPurchases(db, actor, 'al_bayan', null, null).entries[0];
    // A finalized day remains governed by its own correction rules, not by reports.
    assert.throws(() => deletePurchaseEntry(db, actor, 'al_bayan', entry.id,
      { requestId: 'overview-reject-delete', expectedVersion: entry.version, expectedDayVersion: entry.dayVersion }, 'test'));
    assert.equal(reportOverview(db, actor.organizationId).position.cashUnits, 70);
  } finally { db.close(); }
});

test('pending and approved collections are follow-up data and never added to cash or counted twice', () => {
  const { db, admin, collector, assignments } = collectionFixture();
  try {
    const first = submitCollection(db, collector, assignments[0], { requestId: 'overview-pending-1', mode: 'partial', amountUnits: 20 }, 'test');
    submitCollection(db, collector, assignments[0], { requestId: 'overview-pending-2', mode: 'partial', amountUnits: 30 }, 'test');
    createUnlinkedCollectionReceipt(db, collector, { requestId: 'overview-unlinked', customerName: 'Unlinked overview', amountUnits: 40 }, 'test');
    const before = reportOverview(db, admin.organizationId);
    assert.equal(before.attention.pendingCount, 3);
    assert.equal(before.attention.pendingUnits, 90);
    assert.equal(before.position.receivablesUnits, 300);
    decideCollection(db, admin, first.id, { decision: 'approve' }, 'test');
    const after = reportOverview(db, admin.organizationId);
    assert.equal(after.attention.pendingUnits, 70);
    assert.equal(after.attention.outstandingUnits, 20);
    assert.equal(after.position.receivablesUnits, 280);
    assert.equal(after.position.cashUnits, 0);
    assert.equal(after.daily.paymentsUnits, 20);
  } finally { db.close(); }
});

test('activity handles timezone boundaries, corrections and cancellations without mutating source data', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const customer = createCustomer(db, actor, { requestId: 'overview-date-customer', name: 'Date customer' }, 'test');
    const id = String((customer.body.customer as { id: string }).id);
    const add = (date: string, requestId: string) => addCustomerTransaction(db, actor, id, { requestId, expectedVersion:
      Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version), type: 'debt', inputValue: 10, date }, 'test');
    add('2026-10-23T21:59:59.999Z', 'overview-date-before');
    const same = add('2026-10-24T00:00:00+02:00', 'overview-date-start');
    add('2026-10-24T21:59:59.999Z', 'overview-date-end');
    add('2026-10-24T22:00:00.000Z', 'overview-date-after');
    const now = new Date('2026-10-24T12:00:00Z');
    assert.equal(reportOverview(db, actor.organizationId, now).daily.debtsUnits, 20);
    assert.equal(reportActivity(db, actor.organizationId, url('?group=customers'), now).items.length, 2);
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version);
    correctCustomerTransaction(db, actor, id, String((same.body.transaction as { id: string }).id), { requestId: 'overview-date-correction', expectedVersion: version,
      type: 'debt', inputValue: 25, date: '2026-10-24T00:00:00+02:00' }, 'test');
    assert.equal(reportOverview(db, actor.organizationId, now).daily.debtsUnits, 35);
    const before = snapshot(db);
    db.exec('PRAGMA query_only=ON');
    reportOverview(db, actor.organizationId, now);
    reportSourceDetails(db, actor.organizationId, url('?group=customers'));
    assert.equal(snapshot(db), before);
  } finally { db.close(); }
});

test('report API requires report permission, scopes organizations and rejects invalid filters', async () => {
  const { db, collector } = collectionFixture();
  const server = createApp(db, loadConfig({ databasePath: ':memory:', internetRequired: false, secureCookie: false }));
  try {
    await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const session = createSession(db, collector.id, 'test', 12);
    for (const path of ['/api/reports/overview', '/api/reports/activity', '/api/reports/sources?group=customers']) {
      assert.equal((await fetch(base + path)).status, 401);
      assert.equal((await fetch(base + path, { headers: { cookie: `abdo_session=${session.token}` } })).status, 403);
    }
    assert.equal(reportOverview(db, 'org-not-present').position.netUnits, 0);
    assert.equal(reportActivity(db, 'org-not-present', url()).items.length, 0);
    assert.equal(reportSourceDetails(db, 'org-not-present', url('?group=customers')).items.length, 0);
    assert.throws(() => reportActivity(db, collector.organizationId, url('?group=__proto__')));
    assert.throws(() => reportSourceDetails(db, collector.organizationId, url('?group=customers&page=0')));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test('linked EGP is counted once and fixed 5 AM comparisons retain their recorded components', () => {
  const { db, admin } = reportOverviewFixture();
  try {
    const report = reportOverview(db, admin.organizationId);
    assert.equal(report.position.egyptianUnits, 73400, '73000 ordinary + 400 Vodafone source, without adding its source twice');
    assert.ok(report.sources.find(source => source.key === 'egyptian')!.linkedCount >= 1);
    assert.equal(report.position.netUnits, treasuryDashboard(db, admin.organizationId).netUnits);
    assert.equal(report.closings.length, 3);
    assert.equal(report.closings[0].changeUnits, 4000);
    assert.equal(report.closings[0].cashUnits, 20000);
    assert.equal(report.closings[0].cashChangeUnits, 4000);
    assert.equal(report.position.cashUnits, 18000, 'Current cash differs from the immutable 5 AM cash snapshot');
    assert.equal(report.closings[0].reasons.reduce((value, reason) => value + (reason.changeUnits ?? 0), 0), 4000);
    const fixed = report.closings;
    addTreasuryCashEntry(db, admin, { requestId: 'overview-after-fixed-closing', expectedVersion: treasuryDashboard(db, admin.organizationId).cashVersion,
      direction: 'in', amountUnits: 99 }, 'test');
    assert.deepEqual(reportOverview(db, admin.organizationId).closings, fixed);
    db.prepare('DELETE FROM daily_financial_closings').run();
    const before = snapshot(db);
    assert.equal(reportOverview(db, admin.organizationId, new Date('2026-10-24T02:00:00Z')).latestClosing.state, 'pending');
    assert.equal(reportOverview(db, admin.organizationId, new Date('2026-10-24T04:00:00Z')).latestClosing.state, 'missed');
    assert.equal(snapshot(db), before, 'A missed closing must never be invented by a read');
    db.prepare("UPDATE organization_settings SET timezone='America/New_York' WHERE organization_id=?").run(admin.organizationId);
    const timezoneCheck = reportOverview(db, admin.organizationId, new Date('2026-10-23T23:00:00Z'));
    assert.equal(timezoneCheck.businessDate, '2026-10-23');
    assert.equal(timezoneCheck.latestClosing.businessDate, '2026-10-23', '5 AM closing dates remain in Libya time');
  } finally { db.close(); }
});

test('source totals cover every page, keep credit balances and reject unsafe sums instead of rounding them', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    for (let index = 0; index < 53; index++) createCustomer(db, admin, { requestId: `overview-page-${index}`,
      name: `Paged overview ${String(index).padStart(2, '0')}`, openingBalance: 10 }, 'test');
    const first = reportSourceDetails(db, admin.organizationId, url('?group=customers'));
    assert.equal(first.items.length, 50);
    assert.equal(first.hasMore, true);
    const second = reportSourceDetails(db, admin.organizationId, url('?group=customers&page=2'));
    assert.equal(second.items.length, 3);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 53);
    assert.equal(reportOverview(db, admin.organizationId).position.receivablesUnits, 530);
    const id = first.items[0].id;
    db.prepare('UPDATE customers SET current_balance_units=-10 WHERE id=?').run(id);
    assert.equal(reportOverview(db, admin.organizationId).position.receivablesUnits, 510);
    assert.equal(reportSourceDetails(db, admin.organizationId, url('?group=customers')).items[0].balanceUnits, -10);
    db.prepare('UPDATE customers SET current_balance_units=? WHERE id=?').run(9007199254740992n, id);
    assert.throws(() => reportOverview(db, admin.organizationId), /الحد الرقمي الآمن/);
    assert.equal(db.isTransaction, false, 'Failed read rolls back its snapshot');
  } finally { db.close(); }
});

test('report derives large historical account movement amounts exactly from integer source fields', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const created = createCustomer(db, admin, { requestId: 'overview-large-historical', name: 'Large historical', openingBalance: 1 }, 'test');
    const id = String((created.body.customer as { id: string }).id);
    const exact = 9007199254740001n;
    db.prepare('UPDATE debt_transactions SET amount_units=? WHERE customer_id=?').run(exact, id);
    db.prepare('UPDATE customers SET current_balance_units=? WHERE id=?').run(exact, id);
    const report = reportOverview(db, admin.organizationId);
    assert.equal(report.position.receivablesUnits, Number(exact));
    assert.equal(report.daily.debtsUnits, Number(exact));
    const activity = reportActivity(db, admin.organizationId, url('?group=customers'));
    assert.equal(activity.items[0].amountUnits, Number(exact));
    assert.equal(activity.items[0].effectUnits, Number(exact));
  } finally { db.close(); }
});
