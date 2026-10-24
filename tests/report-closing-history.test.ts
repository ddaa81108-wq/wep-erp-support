import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';
import { readClosingPage, closingJournal } from '../src/server/domain/reports/reportClosingHistory.ts';
import { captureFiveAmClosing } from '../src/server/domain/reports/fiveAmClosing.ts';
import { createCustomer, addCustomerTransaction, correctCustomerTransaction } from '../src/server/domain/customers.ts';
import { reportOverview } from '../src/server/domain/reports/reportOverview.ts';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const journalUrl = (day: string) => new URL('http://localhost/api/reports/closing-journal?day=' + day);

test('closing comparisons expose 20 actual records and paginate older snapshots without gaps or fabricated days', () => {
  const { db, admin } = reportOverviewFixture(45);
  try {
    const before = JSON.stringify(db.prepare('SELECT * FROM daily_financial_closings ORDER BY business_date').all());
    db.exec('PRAGMA query_only=ON');
    const report = reportOverview(db, admin.organizationId);
    assert.equal(report.closings.length, 20);
    assert.equal(report.closingsHasMore, true);
    const second = readClosingPage(db, admin.organizationId, report.closings.at(-1)!.businessDate);
    assert.equal(second.items.length, 20);
    assert.equal(second.hasMore, true);
    const third = readClosingPage(db, admin.organizationId, second.nextBefore);
    assert.equal(third.items.length, 5);
    assert.equal(third.hasMore, false);
    const records = [...report.closings, ...second.items, ...third.items];
    assert.equal(new Set(records.map(row => row.businessDate)).size, 45);
    for (let index = 0; index < records.length - 1; index++) {
      assert.equal(records[index].changeUnits, records[index].netUnits! - records[index + 1].netUnits!);
      assert.equal(records[index].previousBusinessDate, records[index + 1].businessDate);
    }
    assert.equal(records.at(-1)!.changeUnits, null);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM daily_financial_closings ORDER BY business_date').all()), before);
    assert.deepEqual(readClosingPage(db, 'another-organization').items, []);
    assert.throws(() => readClosingPage(db, admin.organizationId, '2026-99-99'));
  } finally { db.close(); }
});

test('5 AM operation journal uses execution order, keeps original audit values and excludes post-capture writes even in the same millisecond', context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T02:59:00Z') });
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const created = createCustomer(db, actor, { requestId: 'journal-party-opening', name: 'Journal customer', openingBalance: 100 }, 'test');
    const id = String((created.body.customer as { id: string }).id);
    context.mock.timers.setTime(Date.parse('2026-10-21T03:00:00Z'));
    assert.equal(captureFiveAmClosing(db, actor.organizationId, Date.now() - 60_000), true);
    const add = (amount: number, requestId: string) => addCustomerTransaction(db, actor, id, { requestId,
      expectedVersion: Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version),
      type: 'debt', inputValue: amount, date: '2026-10-01T12:00:00Z' }, 'test');
    context.mock.timers.setTime(Date.parse('2026-10-21T04:00:00Z'));
    const original = add(25, 'journal-backdated-entry');
    context.mock.timers.setTime(Date.parse('2026-10-22T03:00:00Z'));
    captureFiveAmClosing(db, actor.organizationId, Date.now() - 60_000);
    add(999, 'journal-same-ms-after-capture');
    const url = journalUrl('2026-10-21');
    const initial = closingJournal(db, actor.organizationId, url);
    assert.equal(initial.boundary, 'sequence');
    assert.deepEqual(initial.items.map(item => item.amountUnits), [25]);
    context.mock.timers.setTime(Date.parse('2026-10-22T04:00:00Z'));
    correctCustomerTransaction(db, actor, id, String((original.body.transaction as { id: string }).id), {
      requestId: 'journal-later-correction', expectedVersion: Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version),
      type: 'debt', inputValue: 30, date: '2026-10-01T12:00:00Z',
    }, 'test');
    assert.deepEqual(closingJournal(db, actor.organizationId, url), initial, 'Later source changes must not rewrite an earlier audit period');
    context.mock.timers.setTime(Date.parse('2026-10-23T03:00:00Z'));
    captureFiveAmClosing(db, actor.organizationId, Date.now() - 60_000);
    const next = closingJournal(db, actor.organizationId, journalUrl('2026-10-22'));
    assert.ok(next.items.some(item => item.previousUnits === 25 && item.nextUnits === 30));
    assert.ok(next.items.some(item => item.amountUnits === 999));
    db.exec('PRAGMA query_only=ON');
    assert.deepEqual(closingJournal(db, actor.organizationId, url), initial);
    assert.throws(() => closingJournal(db, 'another-organization', url));
    assert.throws(() => closingJournal(db, actor.organizationId, journalUrl('2026-99-99')));
  } finally { db.close(); }
});

test('legacy closing journal is explicitly timestamp-bounded and audit access stays administrator-only', async () => {
  const { db, admin, collector } = collectionFixture();
  let server: ReturnType<typeof createApp> | undefined;
  try {
    const snapshot = { receivablesUnits: 300, liabilitiesUnits: 0, activeCashUnits: 0, egyptianSourceUnits: 0,
      egyptianConvertedUnits: 0, egyptianRate: null, netUnits: 300 };
    for (const [day, at] of [['2026-10-20', '2026-10-21T03:00:00Z'], ['2026-10-21', '2026-10-22T03:00:00Z']])
      db.prepare('INSERT INTO daily_financial_closings VALUES(?,?,?,?,?)').run(admin.organizationId, day, at, at, JSON.stringify(snapshot));
    const addAudit = (at: string, action: string, amount: number) => db.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,
      correlation_id,outcome,details_json,created_at) VALUES(?,?,?,'test','test','test','success',?,?)`)
      .run(admin.id, admin.organizationId, action, JSON.stringify({ amountUnits: amount, subjectName: 'Original audit name', password: 'must-not-be-returned' }), at);
    addAudit('2026-10-21T05:00:00Z', 'customer.debt', 7);
    addAudit('2026-10-22T03:00:01Z', 'customer.debt', 999);
    addAudit('2026-10-21T05:00:00Z', 'user.password.change', 999);
    const journal = closingJournal(db, admin.organizationId, journalUrl('2026-10-21'));
    assert.equal(journal.boundary, 'time');
    assert.equal(journal.items.length, 1);
    assert.equal(journal.items[0].amountUnits, 7);
    assert.ok(!JSON.stringify(journal).includes('must-not-be-returned'));
    db.prepare("INSERT INTO user_permissions VALUES(?,'reports.read',1,?)").run(collector.id, new Date().toISOString());
    server = createApp(db, loadConfig({ databasePath: ':memory:', internetRequired: false, secureCookie: false }));
    await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const employeeSession = createSession(db, collector.id, '1', 12);
    const adminSession = createSession(db, admin.id, '1', 12);
    const path = '/api/reports/closing-journal?day=2026-10-21';
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, { headers: { cookie: `abdo_session=${employeeSession.token}` } })).status, 403);
    assert.equal((await fetch(base + '/api/reports/closing-history', { headers: { cookie: `abdo_session=${employeeSession.token}` } })).status, 200);
    assert.equal((await fetch(base + path, { headers: { cookie: `abdo_session=${adminSession.token}` } })).status, 200);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    db.close();
  }
});
