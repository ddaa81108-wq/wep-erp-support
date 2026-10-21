import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase, inImmediateTransaction } from '../src/server/db/database.ts';
import {
  captureFiveAmClosing,
  readFiveAmClosing,
  fiveAmDeadline,
} from '../src/server/domain/reports/fiveAmClosing.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { treasuryDashboard } from '../src/server/domain/treasuryQueries.ts';
import {
  reportsDashboard,
  refreshDailyReport,
  finalizePastReports,
} from '../src/server/domain/reports/reports.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import { closingText } from '../src/client/sections/reports/reportViewModel.ts';

const org = 'org-default';
const before = new Date('2026-10-21T02:59:00Z');
const due = new Date('2026-10-21T03:00:10Z');

test('05:00 Libya closes the previous calendar day, including year and leap boundaries', () => {
  assert.equal(fiveAmDeadline('2026-10-20').toISOString(), '2026-10-21T03:00:00.000Z');
  assert.equal(fiveAmDeadline('2026-12-31').toISOString(), '2027-01-01T03:00:00.000Z');
  assert.equal(fiveAmDeadline('2028-02-29').toISOString(), '2028-03-01T03:00:00.000Z');
});

test('captures treasury truth exactly once and leaves the existing historical report unchanged', () => {
  const db = openDatabase(':memory:');
  try {
    treasuryDashboard(db, org);
    db.prepare('UPDATE treasury_cash_accounts SET balance_units=1500 WHERE organization_id=?').run(org);
    refreshDailyReport(db, org, '2026-10-20');
    finalizePastReports(db, org, '2026-10-21');
    const original = db.prepare('SELECT * FROM daily_financial_reports').all();
    assert.equal(captureFiveAmClosing(db, org, before.getTime(), before), false);
    inImmediateTransaction(db, () =>
      assert.equal(captureFiveAmClosing(db, org, before.getTime(), due), true),
    );
    const first = readFiveAmClosing(db, org, '2026-10-20', due);
    assert.equal(first.state, 'recorded');
    assert.equal(first.netUnits, 1500);
    assert.equal(first.capturedAt, due.toISOString());
    db.prepare('UPDATE treasury_cash_accounts SET balance_units=-900 WHERE organization_id=?').run(org);
    assert.equal(captureFiveAmClosing(db, org, before.getTime(), new Date('2026-10-21T03:00:50Z')), false);
    assert.deepEqual(readFiveAmClosing(db, org, '2026-10-20', new Date('2026-10-24')), first);
    assert.deepEqual(db.prepare('SELECT * FROM daily_financial_reports').all(), original);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM event_log WHERE topic='treasury.report.closed'").get()!.n,
      1,
    );
    const api = reportsDashboard(db, org, new URL('http://local/api/reports'));
    assert.deepEqual(api.items.find((row) => row.businessDate === '2026-10-20')!.fiveAmClosing, first);
  } finally {
    db.close();
  }
});

test('a late start or missed capture window never fabricates an earlier closing', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(readFiveAmClosing(db, org, '2026-10-20', before).state, 'pending');
    assert.equal(captureFiveAmClosing(db, org, due.getTime(), due), false);
    const late = new Date('2026-10-21T03:01:00Z');
    assert.equal(captureFiveAmClosing(db, org, before.getTime(), late), false);
    assert.equal(readFiveAmClosing(db, org, '2026-10-20', late).state, 'missed');
    assert.equal(readFiveAmClosing(db, org, '2026-10-19', due).state, 'missed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_financial_closings').get()!.n, 0);
  } finally {
    db.close();
  }
});

test('missing rate is frozen as incomplete rather than zero or recalculated later', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    createCustomer(
      db,
      actor,
      {
        name: 'أمانة مصرية اختبار',
        sectionKey: 'egyptian_deposits',
        openingBalance: 100,
        requestId: 'closing-egp',
      },
      'test',
    );
    // The account command defaults to customers; explicitly select this fixture's section.
    db.prepare("UPDATE customers SET section_key='egyptian_deposits' WHERE name=?").run('أمانة مصرية اختبار');
    inImmediateTransaction(db, () => captureFiveAmClosing(db, org, before.getTime(), due));
    const first = readFiveAmClosing(db, org, '2026-10-20', due);
    assert.equal(first.state, 'missing_rate');
    assert.equal(first.netUnits, null);
    setEgyptianDepositRate(db, actor, 10);
    assert.deepEqual(readFiveAmClosing(db, org, '2026-10-20', due), first);
  } finally {
    db.close();
  }
});

test('scheduled capture runs without an open browser and survives restart unchanged', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: before });
  const db = openDatabase(':memory:');
  let stop = startReportScheduler(db);
  try {
    db.prepare('UPDATE treasury_cash_accounts SET balance_units=700 WHERE organization_id=?').run(org);
    context.mock.timers.tick(60_000);
    const closed = readFiveAmClosing(db, org, '2026-10-20');
    assert.equal(closed.state, 'recorded');
    assert.equal(closed.netUnits, 700);
    stop();
    db.prepare('UPDATE treasury_cash_accounts SET balance_units=999 WHERE organization_id=?').run(org);
    stop = startReportScheduler(db);
    assert.deepEqual(readFiveAmClosing(db, org, '2026-10-20'), closed);
  } finally {
    stop();
    db.close();
  }
});

test('closing and its invalidation event roll back with the surrounding transaction', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() =>
      inImmediateTransaction(db, () => {
        captureFiveAmClosing(db, org, before.getTime(), due);
        throw Error('rollback');
      }),
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_financial_closings').get()!.n, 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM event_log WHERE topic='treasury.report.closed'").get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});

test('signed amount is displayed as ours, owed, balanced or genuinely unavailable', () => {
  const base = {
    state: 'recorded' as const,
    scheduledAt: due.toISOString(),
    capturedAt: due.toISOString(),
    netUnits: 200,
  };
  assert.match(closingText(base), /لنا/);
  assert.match(closingText({ ...base, netUnits: -200 }), /علينا/);
  assert.match(closingText({ ...base, netUnits: 0 }), /متوازن/);
  assert.match(closingText({ ...base, state: 'missed', netUnits: null }), /لم يُسجّل/);
  assert.match(closingText({ ...base, state: 'missing_rate', netUnits: null }), /غير مكتمل/);
});
