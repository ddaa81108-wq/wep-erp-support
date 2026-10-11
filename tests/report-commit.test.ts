import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inImmediateTransaction, openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { addTreasuryCashEntry, treasuryDashboard } from '../src/server/domain/treasury.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const organizationId = 'org-default';
function admin(database: AppDatabase): AuthenticatedUser {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,
    organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'report-admin',
      'report-admin',
      'Report Admin',
      'test-only',
      'admin',
      organizationId,
      'branch-main',
      now,
      now,
    );
  return {
    id: 'report-admin',
    username: 'report-admin',
    displayName: 'Report Admin',
    role: 'admin',
    organizationId,
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'test',
    csrfHash: 'test',
  };
}
function report(database: AppDatabase, day: string) {
  return database
    .prepare('SELECT * FROM daily_financial_reports WHERE organization_id=? AND business_date=?')
    .get(organizationId, day) as Record<string, unknown>;
}
function cash(database: AppDatabase, actor: AuthenticatedUser, amount: number, requestId: string) {
  return addTreasuryCashEntry(
    database,
    actor,
    {
      requestId,
      direction: 'in',
      amountUnits: amount,
      expectedVersion: treasuryDashboard(database, organizationId).cashVersion,
    },
    'report-test',
  );
}

test('last-minute transactions persist reports before a restart and exclude next-day cash', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T21:59:50Z') });
  const directory = mkdtempSync(join(tmpdir(), 'abdo-report-commit-'));
  const path = join(directory, 'test.sqlite');
  let database = openDatabase(path);
  const actor = admin(database);
  let stop = startReportScheduler(database);
  try {
    context.mock.timers.setTime(new Date('2026-10-11T21:59:59Z').getTime());
    cash(database, actor, 500, 'cash-before-midnight');
    assert.equal(report(database, '2026-10-11').active_cash_units, 500);
    assert.equal(report(database, '2026-10-11').daily_cash_in_units, 500);
    stop();
    database.close();
    context.mock.timers.setTime(new Date('2026-10-12T06:00:00Z').getTime());
    database = openDatabase(path);
    stop = startReportScheduler(database);
    cash(database, actor, 200, 'cash-after-restart');
    const yesterday = report(database, '2026-10-11');
    assert.equal(yesterday.is_finalized, 1);
    assert.equal(yesterday.active_cash_units, 500);
    assert.equal(yesterday.daily_cash_in_units, 500);
    assert.equal(yesterday.net_units, 500);
    const today = report(database, '2026-10-12');
    assert.equal(today.active_cash_units, 700);
    assert.equal(today.daily_cash_in_units, 200);
  } finally {
    stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('nested financial writes update reports only with the final committed state and roll back together', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const database = openDatabase(':memory:');
  const actor = admin(database);
  const stop = startReportScheduler(database);
  try {
    inImmediateTransaction(database, () => {
      cash(database, actor, 100, 'nested-first-cash');
      cash(database, actor, 200, 'nested-second-cash');
      assert.equal(report(database, '2026-10-11').active_cash_units, 0);
    });
    assert.equal(report(database, '2026-10-11').active_cash_units, 300);
    assert.throws(
      () =>
        inImmediateTransaction(database, () => {
          cash(database, actor, 400, 'rolled-back-cash');
          throw new Error('rollback test');
        }),
      /rollback test/,
    );
    assert.equal(treasuryDashboard(database, organizationId).activeCashUnits, 300);
    assert.equal(report(database, '2026-10-11').active_cash_units, 300);
    database.exec(`CREATE TEMP TRIGGER fail_report BEFORE UPDATE ON daily_financial_reports
      BEGIN SELECT RAISE(ABORT, 'report write failed'); END`);
    assert.throws(() => cash(database, actor, 500, 'failed-report-cash'), /report write failed/);
    assert.equal(treasuryDashboard(database, organizationId).activeCashUnits, 300);
    assert.equal(report(database, '2026-10-11').active_cash_units, 300);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS n FROM treasury_cash_entries').get()!.n), 2);
  } finally {
    stop();
    database.close();
  }
});

test('section balances and Egyptian exchange-rate changes reach reports in the same transaction', (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T12:00:00Z') });
  const database = openDatabase(':memory:');
  const actor = admin(database);
  const stop = startReportScheduler(database);
  try {
    createCustomer(
      database,
      actor,
      { requestId: 'report-new-customer', name: 'Test Customer', openingBalance: 1000 },
      'report-test',
    );
    createCustomer(
      database,
      actor,
      { requestId: 'report-egyptian-account', name: 'Test Egyptian', openingBalance: 500 },
      'report-test',
      'depositEgp',
    );
    assert.equal(report(database, '2026-10-11').receivables_units, 1000);
    assert.equal(report(database, '2026-10-11').egyptian_source_units, 500);
    assert.equal(report(database, '2026-10-11').net_units, null);
    setEgyptianDepositRate(database, actor, 5);
    assert.equal(report(database, '2026-10-11').egyptian_converted_units, 100);
    assert.equal(report(database, '2026-10-11').net_units, 1100);
    assert.equal(report(database, '2026-10-11').active_cash_units, 0);
  } finally {
    stop();
    database.close();
  }
});
