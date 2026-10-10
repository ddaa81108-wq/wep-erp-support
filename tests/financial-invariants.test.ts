import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { maintainOperationalData, openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { addTreasuryCashEntry, treasuryDashboard } from '../src/server/domain/treasury.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';
import { finalizePastReports, refreshDailyReport, reportsDashboard } from '../src/server/domain/reports/reports.ts';
import { analyzePosition } from '../src/server/domain/reports/reportModel.ts';

const ORGANIZATION_ID = 'org-default';
const BRANCH_ID = 'branch-main';
const databases: AppDatabase[] = [];

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

function testDatabase() {
  const database = openDatabase(':memory:');
  databases.push(database);
  return database;
}

function createAdmin(database: AppDatabase): AuthenticatedUser {
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO users(
        id,username,display_name,password_hash,role,
        organization_id,home_branch_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `,
    )
    .run(
      'financial-invariants-admin',
      'financial-invariants-admin',
      'مدير اختبار القواعد المالية',
      'test-only-password-hash',
      'admin',
      ORGANIZATION_ID,
      BRANCH_ID,
      now,
      now,
    );
  return {
    id: 'financial-invariants-admin',
    username: 'financial-invariants-admin',
    displayName: 'مدير اختبار القواعد المالية',
    role: 'admin',
    organizationId: ORGANIZATION_ID,
    homeBranchId: BRANCH_ID,
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'test-session',
    csrfHash: 'test-csrf',
  };
}

function addSectionBalance(
  database: AppDatabase,
  id: string,
  sectionKey: string,
  balanceUnits: number,
) {
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO customers(
        id,name,normalized_name,organization_id,section_key,
        current_balance_units,financial_updated_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `,
    )
    .run(
      id,
      `حساب ${id}`,
      `financial-invariant-${id}`,
      ORGANIZATION_ID,
      sectionKey,
      balanceUnits,
      now,
      now,
      now,
    );
}

test('treasury is derived only from section totals plus manually controlled active cash', () => {
  const database = testDatabase();
  const actor = createAdmin(database);

  addSectionBalance(database, 'customer-debt', 'customer_debts', 3_000);
  addSectionBalance(database, 'company-debt', 'company_debts', 2_000);
  addSectionBalance(database, 'libyan-liability', 'libyan_deposits', 1_200);

  const egyptianSystemAccount = database
    .prepare(
      `
      SELECT id FROM customers
      WHERE organization_id=? AND section_key='egyptian_deposits'
        AND system_link_key='masraweya_remainder'
    `,
    )
    .get(ORGANIZATION_ID) as { id: string };
  database
    .prepare(
      `
      UPDATE customers
      SET current_balance_units=1_650, financial_updated_at=?, updated_at=?
      WHERE id=?
    `,
    )
    .run(new Date().toISOString(), new Date().toISOString(), egyptianSystemAccount.id);
  setEgyptianDepositRate(database, actor, 5.5);

  const initial = treasuryDashboard(database, ORGANIZATION_ID);
  assert.equal(initial.receivablesUnits, 5_000);
  assert.equal(initial.liabilitiesUnits, 1_200);
  assert.equal(initial.egyptianSourceUnits, 1_650);
  assert.equal(initial.egyptianConvertedUnits, 300);
  assert.equal(initial.activeCashUnits, 0);
  assert.equal(initial.netUnits, 4_100);

  // A customer payment changes the source section only. It must never create cash implicitly.
  database
    .prepare(
      `
      UPDATE customers
      SET current_balance_units=2_500, financial_updated_at=?, updated_at=?
      WHERE id='customer-debt'
    `,
    )
    .run(new Date().toISOString(), new Date().toISOString());
  const afterCustomerPayment = treasuryDashboard(database, ORGANIZATION_ID);
  assert.equal(afterCustomerPayment.receivablesUnits, 4_500);
  assert.equal(afterCustomerPayment.activeCashUnits, 0);
  assert.equal(afterCustomerPayment.netUnits, 3_600);

  const cashEntry = addTreasuryCashEntry(
    database,
    actor,
    {
      direction: 'in',
      amountUnits: 1_000,
      expectedVersion: afterCustomerPayment.cashVersion,
      requestId: 'financial-invariants-cash-in-1',
      description: 'إيداع إداري اختباري',
    },
    'financial-invariants-correlation-1',
  );
  assert.equal(cashEntry.activeCashUnits, 1_000);

  const afterManualCash = treasuryDashboard(database, ORGANIZATION_ID);
  assert.equal(afterManualCash.receivablesUnits, 4_500);
  assert.equal(afterManualCash.activeCashUnits, 1_000);
  assert.equal(afterManualCash.netUnits, 4_600);
});

test('daily reports reuse treasury truth, preserve history, and flag exceptional drops', () => {
  const database = testDatabase();
  const actor = createAdmin(database);
  addSectionBalance(database, 'report-customer-debt', 'customer_debts', 100_000);
  addSectionBalance(database, 'report-company-debt', 'company_debts', 20_000);
  addSectionBalance(database, 'report-libyan-liability', 'libyan_deposits', 10_000);
  setEgyptianDepositRate(database, actor, 5);

  const first = refreshDailyReport(database, ORGANIZATION_ID, '2026-10-01');
  assert.equal(first.receivablesUnits, 120_000);
  assert.equal(first.liabilitiesUnits, 10_000);
  assert.equal(first.netUnits, 110_000);
  assert.equal(first.status, 'normal');
  refreshDailyReport(database, ORGANIZATION_ID, '2026-10-01');
  assert.equal(Number((database.prepare(`
    SELECT COUNT(*) AS count FROM daily_financial_reports
    WHERE organization_id=? AND business_date='2026-10-01'
  `).get(ORGANIZATION_ID) as { count: number }).count), 1);

  database.prepare(`
    UPDATE customers SET current_balance_units=10_000,updated_at=?,financial_updated_at=?
    WHERE id='report-customer-debt'
  `).run(new Date().toISOString(), new Date().toISOString());
  const second = refreshDailyReport(database, ORGANIZATION_ID, '2026-10-02');
  assert.equal(second.netUnits, 20_000);
  assert.equal(second.status, 'critical');
  assert.equal(second.reasons[0]?.key, 'receivables');

  assert.equal(finalizePastReports(database, ORGANIZATION_ID, '2026-10-03'), 2);
  assert.equal(finalizePastReports(database, ORGANIZATION_ID, '2026-10-03'), 0);
  database.prepare(`
    UPDATE customers SET current_balance_units=999999,updated_at=?,financial_updated_at=?
    WHERE id='report-customer-debt'
  `).run(new Date().toISOString(), new Date().toISOString());
  const immutableSecond = refreshDailyReport(database, ORGANIZATION_ID, '2026-10-02');
  assert.equal(immutableSecond.netUnits, 20_000);
  assert.equal(immutableSecond.isFinalized, true);
  assert.notEqual(immutableSecond.finalizedAt, null);

  const dashboard = reportsDashboard(
    database,
    ORGANIZATION_ID,
    new URL('http://localhost/api/reports?limit=2'),
  );
  assert.equal(dashboard.items.length, 2);
  assert.equal(
    dashboard.items
      .filter((item) => item.businessDate < '2026-10-03')
      .every((item) => item.isFinalized),
    true,
  );
  assert.equal(dashboard.items[0]!.sequence > dashboard.items[1]!.sequence, true);
  assert.equal(new Set(dashboard.items.map((item) => item.businessDate)).size, dashboard.items.length);
  assert.equal(dashboard.methodology.currency, 'LYD');
});

test('report analysis never labels a position change as accounting profit', () => {
  const result = analyzePosition(
    { receivablesUnits: 120, liabilitiesUnits: 10, activeCashUnits: 20, egyptianSourceUnits: 0, egyptianConvertedUnits: 0, egyptianRate: 5, netUnits: 130 },
    { receivablesUnits: 100, liabilitiesUnits: 10, activeCashUnits: 20, egyptianSourceUnits: 0, egyptianConvertedUnits: 0, egyptianRate: 5, netUnits: 110 },
    [],
  );
  assert.equal(result.summary.includes('ربح'), false);
  assert.equal(result.status, 'normal');
});

test('active-cash requests are idempotent and cannot be silently duplicated', () => {
  const database = testDatabase();
  const actor = createAdmin(database);
  const input = {
    direction: 'in',
    amountUnits: 750,
    expectedVersion: 0,
    requestId: 'financial-invariants-idempotency-1',
    description: 'اختبار منع التكرار',
  };

  const first = addTreasuryCashEntry(
    database,
    actor,
    input,
    'financial-invariants-correlation-2',
  );
  const replay = addTreasuryCashEntry(
    database,
    actor,
    input,
    'financial-invariants-correlation-3',
  );

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(treasuryDashboard(database, ORGANIZATION_ID).activeCashUnits, 750);
  const count = database
    .prepare(
      `
      SELECT COUNT(*) AS count FROM treasury_cash_entries
      WHERE organization_id=?
    `,
    )
    .get(ORGANIZATION_ID) as { count: number };
  assert.equal(Number(count.count), 1);
});

test('maintenance never deletes financial idempotency history', () => {
  const database = testDatabase();
  const actor = createAdmin(database);
  database
    .prepare(
      `
      INSERT INTO idempotency_keys(
        actor_user_id,scope,request_id,response_status,response_json,created_at
      ) VALUES(?,?,?,?,?,?)
    `,
    )
    .run(actor.id, 'customer.transaction', 'permanent-request-1', 201, '{}', '2000-01-01T00:00:00.000Z');
  database
    .prepare(
      `
      INSERT INTO purchase_requests(organization_id,request_id,operation,response_json,created_at)
      VALUES(?,?,?,?,?)
    `,
    )
    .run(ORGANIZATION_ID, 'permanent-purchase-1', 'create', '{}', '2000-01-01T00:00:00.000Z');

  maintainOperationalData(database);

  const general = database
    .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE request_id='permanent-request-1'")
    .get() as { count: number };
  const purchases = database
    .prepare("SELECT COUNT(*) AS count FROM purchase_requests WHERE request_id='permanent-purchase-1'")
    .get() as { count: number };
  assert.equal(Number(general.count), 1);
  assert.equal(Number(purchases.count), 1);
});
