import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer, updateCustomerDetails } from '../src/server/domain/customerAccountCommands.ts';
import { addCustomerTransaction } from '../src/server/domain/customerTransactions.ts';
import { businessDayRange, currentBusinessDate } from '../src/server/domain/reports/businessDates.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { addTreasuryCashEntry, treasuryDashboard } from '../src/server/domain/treasury.ts';
import { phoneKey } from '../src/shared/phone.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';

test('financial retries reject changed payloads while identical retries ignore JSON key order', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const input = { requestId: 'create-reliability', name: 'Customer', openingBalance: 100 };
    const first = createCustomer(db, actor, input, 'test');
    assert.equal(
      createCustomer(db, actor, { openingBalance: 100, name: 'Customer', requestId: input.requestId }, 'test')
        .replayed,
      true,
    );
    assert.throws(() => createCustomer(db, actor, { ...input, openingBalance: 200 }, 'test'), {
      code: 'REQUEST_ID_REUSED',
    });
    const id = (first.body.customer as { id: string }).id;
    const payment = {
      requestId: 'payment-reliability',
      expectedVersion: 1,
      type: 'payment',
      inputValue: 20,
      date: '2026-10-01',
    };
    addCustomerTransaction(db, actor, id, payment, 'test');
    assert.equal(addCustomerTransaction(db, actor, id, payment, 'test').replayed, true);
    assert.throws(() => addCustomerTransaction(db, actor, id, { ...payment, inputValue: 40 }, 'test'), {
      code: 'REQUEST_ID_REUSED',
    });
    db.prepare('UPDATE idempotency_keys SET request_fingerprint=NULL WHERE request_id=?').run(
      input.requestId,
    );
    assert.throws(() => createCustomer(db, actor, input, 'test'), { code: 'LEGACY_REQUEST_REVIEW_REQUIRED' });
    assert.equal(db.prepare('SELECT current_balance_units AS n FROM customers WHERE id=?').get(id)!.n, 80);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM debt_transactions WHERE customer_id=?').get(id)!.n, 2);
  } finally {
    db.close();
  }
});

test('phone matching handles Arabic and Persian digits and separators without merging sections', () => {
  assert.equal(phoneKey(' (٠٩١) ٢٣٤-٥٦٧٨ '), '0912345678');
  assert.equal(phoneKey('۰۹۱۲۳۴۵۶۷۸'), '0912345678');
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    createCustomer(db, actor, { requestId: 'phone-first', name: 'First', phone: '٠٩١ ٢٣٤-٥٦٧٨' }, 'test');
    assert.throws(
      () =>
        createCustomer(
          db,
          actor,
          { requestId: 'phone-duplicate', name: 'Second', phone: '0912345678' },
          'test',
        ),
      { code: 'CUSTOMER_ALREADY_EXISTS' },
    );
    createCustomer(
      db,
      actor,
      { requestId: 'phone-company', name: 'Company', phone: '0912345678' },
      'test',
      'company',
    );
    const other = createCustomer(db, actor, { requestId: 'phone-other', name: 'Other' }, 'test');
    assert.throws(
      () =>
        updateCustomerDetails(
          db,
          actor,
          (other.body.customer as { id: string }).id,
          {
            name: 'Other',
            phone: '(091) 2345678',
            expectedVersion: 1,
          },
          'test',
        ),
      { code: 'CUSTOMER_ALREADY_EXISTS' },
    );
  } finally {
    db.close();
  }
});

test('business days honor Cairo daylight-saving boundaries and Tripoli fixed offset', () => {
  const hours = (date: string, zone: string) => {
    const range = businessDayRange(date, zone);
    return (Date.parse(range.end) - Date.parse(range.start)) / 3_600_000;
  };
  assert.equal(hours('2026-04-24', 'Africa/Cairo'), 23);
  assert.equal(hours('2026-10-29', 'Africa/Cairo'), 25);
  assert.equal(hours('2026-04-24', 'Africa/Tripoli'), 24);
  assert.equal(currentBusinessDate(new Date('2026-07-01T21:30:00Z'), 'Africa/Cairo'), '2026-07-02');
  assert.equal(currentBusinessDate(new Date('2026-07-01T21:30:00Z'), 'Africa/Tripoli'), '2026-07-01');
  assert.throws(() => businessDayRange('2026-02-30', 'Africa/Cairo'), /Invalid business date/);
});

test('report scheduler and movement totals use the same organization timezone at midnight', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-07-01T20:59:59.999Z') });
  const db = openDatabase(':memory:');
  const actor = fixtureAdmin(db);
  db.prepare("UPDATE organization_settings SET timezone='Africa/Cairo'").run();
  const stop = startReportScheduler(db);
  try {
    for (const [index, instant] of ['2026-07-01T20:59:59.999Z', '2026-07-01T21:00:00.000Z'].entries()) {
      context.mock.timers.setTime(Date.parse(instant));
      addTreasuryCashEntry(
        db,
        actor,
        {
          requestId: `timezone-cash-${index}`,
          direction: 'in',
          amountUnits: (index + 1) * 100,
          expectedVersion: treasuryDashboard(db, actor.organizationId).cashVersion,
        },
        'test',
      );
    }
    const rows = db
      .prepare(
        'SELECT business_date,daily_cash_in_units,active_cash_units,is_finalized FROM daily_financial_reports ORDER BY business_date',
      )
      .all();
    assert.deepEqual(
      rows.map((row) => Object.values(row)),
      [
        ['2026-07-01', 100, 100, 1],
        ['2026-07-02', 200, 300, 0],
      ],
    );
  } finally {
    stop();
    db.close();
  }
});
