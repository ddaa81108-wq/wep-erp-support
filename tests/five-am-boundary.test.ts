import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beforeTransactionCommit, inImmediateTransaction, openDatabase } from '../src/server/db/database.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { readFiveAmClosing } from '../src/server/domain/reports/fiveAmClosing.ts';

const org = 'org-default';
const before = Date.parse('2026-11-19T02:59:59.500Z');
const due = Date.parse('2026-11-19T03:00:00Z');

for (const lag of [30_000, 120_000]) {
  test(`late capture excludes the first post-05:00 transaction at lag=${lag}`, (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: before });
    const db = openDatabase(':memory:');
    const stop = startReportScheduler(db);
    try {
      inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=100 WHERE organization_id=?').run(org));
      context.mock.timers.setTime(due + lag); // Event loop has not delivered the deadline timer.
      inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=999 WHERE organization_id=?').run(org));
      const closing = readFiveAmClosing(db, org, '2026-11-18');
      assert.equal(closing.state, 'recorded');
      assert.equal(closing.netUnits, 100);
      const snapshot = JSON.parse(String(db.prepare('SELECT snapshot_json FROM daily_financial_closings').get()!.snapshot_json));
      assert.equal(snapshot.asOf, '2026-11-19T03:00:00.000Z');
      assert.equal(snapshot.captureMethod, 'committed-before-deadline');
      assert.equal(db.prepare('SELECT balance_units FROM treasury_cash_accounts').get()!.balance_units, 999);
      inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=222 WHERE organization_id=?').run(org));
      assert.deepEqual(readFiveAmClosing(db, org, '2026-11-18'), closing);
    } finally { stop(); db.close(); }
  });
}

test('a COMMIT crossing 05:00 does not replace the last pre-deadline snapshot', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: before });
  const db = openDatabase(':memory:');
  const stop = startReportScheduler(db);
  let unhook = () => {};
  try {
    inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=100 WHERE organization_id=?').run(org));
    unhook = beforeTransactionCommit(db, () => context.mock.timers.setTime(due + 1));
    inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=999 WHERE organization_id=?').run(org));
    unhook();
    inImmediateTransaction(db, () => undefined);
    assert.equal(readFiveAmClosing(db, org, '2026-11-18').netUnits, 100);
  } finally { unhook(); stop(); db.close(); }
});

test('a failed post-deadline write rolls back closing and never advances its committed cache', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: before });
  const db = openDatabase(':memory:');
  const stop = startReportScheduler(db);
  let unhook = () => {};
  try {
    inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=100 WHERE organization_id=?').run(org));
    context.mock.timers.setTime(due + 10);
    unhook = beforeTransactionCommit(db, () => { throw Error('injected commit failure'); });
    assert.throws(() => inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=999 WHERE organization_id=?').run(org)));
    unhook();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_financial_closings').get()!.n, 0);
    inImmediateTransaction(db, () => undefined);
    assert.equal(readFiveAmClosing(db, org, '2026-11-18').netUnits, 100);
  } finally { unhook(); stop(); db.close(); }
});

test('dedicated timer captures exactly at 05:00 even when the minute timer is off the boundary', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: before });
  const db = openDatabase(':memory:');
  const stop = startReportScheduler(db);
  try {
    inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=100 WHERE organization_id=?').run(org));
    context.mock.timers.tick(500);
    assert.equal(readFiveAmClosing(db, org, '2026-11-18').capturedAt, '2026-11-19T03:00:00.000Z');
  } finally { stop(); db.close(); }
});

test('a service starting after the cutoff cannot invent its pre-cutoff state', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: due + 20_000 });
  const db = openDatabase(':memory:');
  const stop = startReportScheduler(db);
  try {
    inImmediateTransaction(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=999 WHERE organization_id=?').run(org));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_financial_closings').get()!.n, 0);
  } finally { stop(); db.close(); }
});

test('pre-cutoff caches stay isolated between organizations', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: before });
  const db = openDatabase(':memory:');
  db.exec("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('closing-other','Other','closing-other',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
  const stop = startReportScheduler(db);
  try {
    inImmediateTransaction(db, () => {
      db.prepare('UPDATE treasury_cash_accounts SET balance_units=100 WHERE organization_id=?').run(org);
      db.prepare("UPDATE treasury_cash_accounts SET balance_units=700 WHERE organization_id='closing-other'").run();
    });
    context.mock.timers.setTime(due + 20_000);
    inImmediateTransaction(db, () => db.exec('UPDATE treasury_cash_accounts SET balance_units=999'));
    assert.equal(readFiveAmClosing(db, org, '2026-11-18').netUnits, 100);
    assert.equal(readFiveAmClosing(db, 'closing-other', '2026-11-18').netUnits, 700);
  } finally { stop(); db.close(); }
});
