import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { getMasraweyaDay, saveMasraweyaDay } from '../src/server/domain/masraweya.ts';
import { masraweyaToday } from '../src/server/domain/masraweyaCalendar.ts';
import { treasuryDashboard } from '../src/server/domain/treasury.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';

const databases: AppDatabase[] = [];

test('historical Masraweya corrections update current reports without rewriting closed snapshots', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T12:00:00Z') });
  const { db, admin } = setup();
  const stop = startReportScheduler(db);
  try {
    const first = saveMasraweyaDay(db, admin, input('2026-10-10'), 'first');
    context.mock.timers.setTime(Date.parse('2026-10-11T12:00:00Z'));
    saveMasraweyaDay(db, admin, input('2026-10-11', 0, 0, 0), 'next');
    const closed = db
      .prepare("SELECT * FROM daily_financial_reports WHERE business_date='2026-10-10'")
      .get()!;
    assert.equal(closed.is_finalized, 1);
    saveMasraweyaDay(db, admin, input('2026-10-10', first.version, 1200), 'correction');
    assert.deepEqual(
      db.prepare("SELECT * FROM daily_financial_reports WHERE business_date='2026-10-10'").get(),
      closed,
    );
    const current = db
      .prepare("SELECT * FROM daily_financial_reports WHERE business_date='2026-10-11'")
      .get()!;
    assert.equal(current.egyptian_source_units, 1100);
    assert.equal(current.active_cash_units, 0);
  } finally {
    stop();
  }
});
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  return { db, admin: fixtureAdmin(db) };
}
function input(date: string, version = 0, purchases = 1000, value = 100) {
  return {
    businessDate: date,
    expectedVersion: version,
    purchasesUnits: purchases,
    entries: [{ valueUnits: value, commissionUnits: 0 }],
  };
}

test('Masraweya business date changes at 04:00 Tripoli, including month and year boundaries', () => {
  assert.equal(masraweyaToday(new Date('2026-10-11T01:59:59.999Z')), '2026-10-10');
  assert.equal(masraweyaToday(new Date('2026-10-11T02:00:00.000Z')), '2026-10-11');
  assert.equal(masraweyaToday(new Date('2027-01-01T01:00:00Z')), '2026-12-31');
  assert.equal(masraweyaToday(new Date('2026-03-01T01:00:00Z')), '2026-02-28');
});

test('automatic carry preserves negative balances and empty days without a scheduler or approval', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T12:00:00Z') });
  const { db, admin } = setup();
  const first = saveMasraweyaDay(db, admin, input('2026-10-09', 0, 100, 250), 'test');
  assert.equal(first.finalUnits, -150);
  context.mock.timers.setTime(Date.parse('2026-10-11T02:00:00Z'));
  const today = getMasraweyaDay(db, admin.organizationId);
  assert.equal(today.businessDate, '2026-10-11');
  assert.equal(today.previousValueUnits, -150);
  assert.deepEqual(today.entries, []);
  assert.equal(getMasraweyaDay(db, admin.organizationId, '2026-10-10').previousValueUnits, -150);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM masraweya_days').get()!.n, 1);
});

test('correcting a previous day propagates through later openings atomically without changing their rows or active cash', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const { db, admin } = setup();
  const first = saveMasraweyaDay(db, admin, input('2026-10-09'), 'first');
  saveMasraweyaDay(db, admin, input('2026-10-10', 0, 0, 200), 'second');
  saveMasraweyaDay(db, admin, input('2026-10-11', 0, 0, 100), 'third');
  const rowsBefore = db.prepare('SELECT * FROM masraweya_entries WHERE day_id<>? ORDER BY id').all(first.id!);
  saveMasraweyaDay(db, admin, input('2026-10-09', first.version, 1200), 'correction');
  assert.equal(getMasraweyaDay(db, admin.organizationId, '2026-10-10').previousValueUnits, 1100);
  assert.equal(getMasraweyaDay(db, admin.organizationId, '2026-10-11').finalUnits, 800);
  assert.deepEqual(
    db.prepare('SELECT * FROM masraweya_entries WHERE day_id<>? ORDER BY id').all(first.id!),
    rowsBefore,
  );
  const treasury = treasuryDashboard(db, admin.organizationId);
  assert.equal(treasury.egyptianSourceUnits, 800);
  assert.equal(treasury.activeCashUnits, 0);
  const audit = db.prepare("SELECT details_json FROM audit_log WHERE correlation_id='correction'").get()!;
  assert.deepEqual(JSON.parse(String(audit.details_json)).affectedDates, ['2026-10-10', '2026-10-11']);
});

test('server permits authorized staff across seven previous days and protects automatic openings', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const { db, admin } = setup();
  const employee = { ...admin, role: 'employee' as const, permissions: new Set(['masraweya.write']) };
  saveMasraweyaDay(db, employee, { ...input('2026-10-04'), previousValueUnits: 50 }, 'oldest');
  assert.throws(() => saveMasraweyaDay(db, admin, input('2026-10-03'), 'old'), {
    code: 'MASRAWEYA_DATE_LOCKED',
  });
  assert.throws(() => saveMasraweyaDay(db, admin, input('2026-10-12'), 'future'), {
    code: 'MASRAWEYA_DATE_LOCKED',
  });
  saveMasraweyaDay(db, employee, input('2026-10-10'), 'employee-old');
  assert.throws(() => saveMasraweyaDay(db, employee, input('2026-10-03'), 'employee-too-old'), {
    code: 'MASRAWEYA_DATE_LOCKED',
  });
  assert.throws(
    () => saveMasraweyaDay(db, { ...employee, permissions: new Set() }, input('2026-10-11'), 'reader'),
    { code: 'PERMISSION_DENIED' },
  );
  assert.throws(
    () => saveMasraweyaDay(db, admin, { ...input('2026-10-11'), previousValueUnits: 123 }, 'opening'),
    { code: 'MASRAWEYA_OPENING_AUTOMATIC' },
  );
  saveMasraweyaDay(db, employee, input('2026-10-11'), 'employee-today');
});

test('legacy finalized flags never lock a recent day for an administrator or authorized employee', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const { db, admin } = setup();
  const employee = { ...admin, role: 'employee' as const, permissions: new Set(['masraweya.write']) };
  const first = saveMasraweyaDay(db, admin, input('2026-10-11'), 'first');
  db.prepare("UPDATE masraweya_days SET status='finalized',correction_open=0 WHERE id=?").run(first.id!);
  assert.equal(getMasraweyaDay(db, admin.organizationId).editable, true);
  const edited = saveMasraweyaDay(db, admin, input('2026-10-11', first.version, 1100), 'admin-edit');
  saveMasraweyaDay(db, employee, input('2026-10-11', edited.version, 1200), 'employee-edit');
  assert.equal(getMasraweyaDay(db, admin.organizationId).purchasesUnits, 1200);
});

test('incremental saves preserve row IDs and positions, replay identical writes and reject stale changes', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const { db, admin } = setup();
  const draft = {
    ...input('2026-10-11'),
    entries: [
      { valueUnits: 100, commissionUnits: 5 },
      { valueUnits: 0, commissionUnits: 0 },
      { valueUnits: 50, commissionUnits: 0 },
    ],
  };
  const first = saveMasraweyaDay(db, admin, draft, 'first');
  assert.deepEqual(
    first.entries.map((row) => row.sequence),
    [1, 3],
  );
  const repeated = saveMasraweyaDay(db, admin, draft, 'repeat');
  assert.equal(repeated.version, first.version);
  assert.equal(repeated.replayed, true);
  assert.throws(() => saveMasraweyaDay(db, admin, { ...draft, purchasesUnits: 3000 }, 'stale'), {
    code: 'VERSION_CONFLICT',
  });
  const next = saveMasraweyaDay(
    db,
    admin,
    { ...draft, expectedVersion: first.version, purchasesUnits: 2000 },
    'next',
  );
  assert.deepEqual(
    next.entries.map((row) => row.id),
    first.entries.map((row) => row.id),
  );
});

test('unsafe propagated balance rolls back the entire correction', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const { db, admin } = setup();
  const first = saveMasraweyaDay(db, admin, input('2026-10-10', 0, 0, 0), 'first');
  saveMasraweyaDay(db, admin, input('2026-10-11', 0, Number.MAX_SAFE_INTEGER, 0), 'max');
  const before = db.prepare('SELECT * FROM masraweya_days ORDER BY business_date').all();
  assert.throws(() => saveMasraweyaDay(db, admin, input('2026-10-10', first.version, 1, 0), 'overflow'), {
    code: 'MASRAWEYA_TOTAL_OUT_OF_RANGE',
  });
  assert.deepEqual(db.prepare('SELECT * FROM masraweya_days ORDER BY business_date').all(), before);
});
