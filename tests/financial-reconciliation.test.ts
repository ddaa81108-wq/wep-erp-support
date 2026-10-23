import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import {
  createCustomer,
  addCustomerTransaction,
  correctCustomerTransaction,
  cancelCustomerTransaction,
} from '../src/server/domain/customers.ts';
import {
  submitCollection,
  decideCollection,
  closeCollectionDay,
  markCollectionCashReceived,
} from '../src/server/domain/collections.ts';
import { addTreasuryCashEntry } from '../src/server/domain/treasury.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import { listPurchases } from '../src/server/domain/purchaseQueries.ts';
import { createPurchaseEntry, deletePurchaseEntry } from '../src/server/domain/purchaseEntryCommands.ts';
import { setPurchaseOpening, finalizePurchaseDay } from '../src/server/domain/purchaseDayCommands.ts';
import { saveMasraweyaDay } from '../src/server/domain/masraweya.ts';
import { masraweyaToday } from '../src/server/domain/masraweyaCalendar.ts';

test('independent reconciliation handles four sections, linked EGP, different rounding, opening carry, deletions and independent cash', () => {
  const { db, admin, collector, assignments } = collectionFixture();
  try {
    for (const [i, kind] of (['company', 'depositLyd', 'depositEgp'] as const).entries())
      createCustomer(
        db,
        admin,
        { name: `Reconciliation ${kind}`, openingBalance: 10 + i, requestId: `reconcile-account-${kind}` },
        'test',
        kind,
      );
    setEgyptianDepositRate(db, admin, '2');
    let page = listPurchases(db, admin, 'al_bayan', null, null);
    setPurchaseOpening(
      db,
      admin,
      'al_bayan',
      { expectedDayVersion: page.day.version, previousDebtUnits: 100, previousVodafoneUnits: 20 },
      'test',
    );
    page = listPurchases(db, admin, 'al_bayan', null, null);
    createPurchaseEntry(
      db,
      admin,
      'al_bayan',
      {
        requestId: 'reconcile-purchase-one',
        expectedDayVersion: page.day.version,
        itemCode: 'vodafone_cash',
        egpValueUnits: 11,
        calculationMode: 'divide',
        exchangeRate: '2',
        paidUnits: 3,
        vodafoneConsumedUnits: 1,
      },
      'test',
    );
    page = listPurchases(db, admin, 'al_bayan', null, null);
    assert.equal(page.day.totalDebtUnits, 103);
    finalizePurchaseDay(
      db,
      admin,
      'al_bayan',
      { requestId: 'reconcile-finalize-one', expectedDayVersion: page.day.version },
      'test',
    );
    page = listPurchases(db, admin, 'al_bayan', null, null);
    createPurchaseEntry(
      db,
      admin,
      'al_bayan',
      {
        requestId: 'reconcile-purchase-delete',
        expectedDayVersion: page.day.version,
        itemCode: 'custom',
        itemLabel: 'deleted',
        egpValueUnits: 20,
        calculationMode: 'multiply',
        exchangeRate: '2',
        paidUnits: 0,
        vodafoneConsumedUnits: 0,
      },
      'test',
    );
    page = listPurchases(db, admin, 'al_bayan', null, null);
    const entry = page.entries.at(-1)!;
    deletePurchaseEntry(
      db,
      admin,
      'al_bayan',
      entry.id,
      {
        requestId: 'reconcile-delete-purchase',
        expectedDayVersion: page.day.version,
        expectedVersion: entry.version,
      },
      'test',
    );
    saveMasraweyaDay(
      db,
      admin,
      {
        businessDate: masraweyaToday(),
        expectedVersion: 0,
        previousValueUnits: 100,
        purchasesUnits: 20,
        entries: [{ valueUnits: 10, commissionUnits: 2 }],
      },
      'test',
    );
    addTreasuryCashEntry(
      db,
      admin,
      { requestId: 'reconcile-cash-in', expectedVersion: 0, direction: 'in', amountUnits: 50 },
      'test',
    );
    addTreasuryCashEntry(
      db,
      admin,
      { requestId: 'reconcile-cash-out', expectedVersion: 1, direction: 'out', amountUnits: 7 },
      'test',
    );
    const submission = submitCollection(
      db,
      collector,
      assignments[0],
      { requestId: 'reconcile-collection-30', mode: 'partial', amountUnits: 30 },
      'test',
    );
    decideCollection(db, admin, submission.id, { decision: 'approve' }, 'test');
    const pending = submitCollection(
      db,
      collector,
      assignments[0],
      { requestId: 'reconcile-collection-pending', mode: 'partial', amountUnits: 20 },
      'test',
    );
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'matched', JSON.stringify(report.issues));
    assert.equal(report.issueCount, 0);
    const org = report.organizations[0];
    assert.equal(org.activeCashLyd, '43', 'Cash is NOT expected to equal approved collections (30).');
    assert.equal(org.purchasesDebtLyd, '103');
    assert.equal(org.vodafoneRemainderEgp, '30');
    assert.equal(org.sections.find((s) => s.section === 'egyptian_deposits')!.expectedNetUnits, '150');
    decideCollection(db, admin, pending.id, { decision: 'reject' }, 'test');
    markCollectionCashReceived(db, admin, submission.id, 'test');
    const batchId = String(
      db.prepare('SELECT batch_id FROM collection_submissions WHERE id=?').get(submission.id)!.batch_id,
    );
    closeCollectionDay(db, admin, { batchId, confirmed: true }, 'test');
    const archived = reconcileFinancials(db);
    assert.equal(archived.status, 'matched', JSON.stringify(archived));
    assert.equal(archived.organizations[0].counts.archivedCollectionPostings, 1);
  } finally {
    db.close();
  }
});

test('corrections, cancellations and missing EGP rate are not mislabeled as a cash mismatch or zero conversion', () => {
  const { db, admin, ids, collector, assignments } = collectionFixture();
  try {
    const original = addCustomerTransaction(
      db,
      admin,
      ids[0],
      {
        requestId: 'reconcile-floor-create',
        expectedVersion: 1,
        type: 'debt',
        calculationMode: 'divide',
        factor: '2',
        inputValue: 11,
      },
      'test',
    );
    assert.equal((original.body.transaction as { amountUnits: number }).amountUnits, 5);
    const id = String((original.body.transaction as { id: string }).id);
    correctCustomerTransaction(
      db,
      admin,
      ids[0],
      id,
      { requestId: 'reconcile-edit-debt', expectedVersion: 2, type: 'debt', inputValue: 9 },
      'test',
    );
    cancelCustomerTransaction(
      db,
      admin,
      ids[0],
      id,
      { requestId: 'reconcile-cancel-debt', expectedVersion: 3 },
      'test',
    );
    assert.equal(reconcileFinancials(db).status, 'matched');
    createCustomer(
      db,
      admin,
      { name: 'EGP no rate', openingBalance: 9, requestId: 'reconcile-no-egp-rate' },
      'test',
      'depositEgp',
    );
    let report = reconcileFinancials(db);
    assert.equal(report.status, 'needs_review');
    assert.equal(report.issueCount, 0);
    assert.equal(report.organizations[0].expectedTreasuryNetLyd, null);
    assert.ok(report.warnings.some((w) => w.code === 'EGP_CONVERSION_RATE_MISSING'));
    setEgyptianDepositRate(db, admin, '2');
    const submission = submitCollection(
      db,
      collector,
      assignments[0],
      { requestId: 'reconcile-edited-receipt', mode: 'partial', amountUnits: 10 },
      'test',
    );
    const approved = decideCollection(db, admin, submission.id, { decision: 'approve' }, 'test');
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(ids[0])!.version);
    correctCustomerTransaction(
      db,
      admin,
      ids[0],
      approved.transactionId!,
      { requestId: 'reconcile-correct-approved', expectedVersion: version, type: 'payment', inputValue: 8 },
      'test',
    );
    report = reconcileFinancials(db);
    assert.equal(report.issueCount, 0);
    assert.equal(
      report.status,
      'matched',
      'A complete matching audit chain explains the corrected original receipt.',
    );
    assert.equal(report.organizations[0].counts.adjustedCollectionPostings, 1);
    db.prepare(
      "UPDATE audit_log SET details_json='{}' WHERE entity_id=? AND action='customer.transaction.update'",
    ).run(approved.transactionId!);
    assert.equal(
      reconcileFinancials(db).status,
      'needs_review',
      'An unexplainable change must never get a green result.',
    );
  } finally {
    db.close();
  }
});

test('deliberately wrong stored balances and cash chains are detected with exact signed differences without repair', () => {
  const { db, admin, ids } = collectionFixture();
  try {
    addTreasuryCashEntry(
      db,
      admin,
      { requestId: 'reconcile-corrupt-cash', expectedVersion: 0, direction: 'in', amountUnits: 40 },
      'test',
    );
    db.prepare('UPDATE customers SET current_balance_units=117 WHERE id=?').run(ids[0]);
    db.exec(
      'UPDATE treasury_cash_accounts SET balance_units=99; UPDATE treasury_cash_entries SET balance_after_units=98;',
    );
    const before = JSON.stringify(db.prepare('SELECT * FROM customers').all());
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'mismatch');
    assert.ok(
      report.issues.some(
        (i) =>
          i.entityId === ids[0] && i.field === 'customer.current_balance_units' && i.differenceUnits === '17',
      ),
    );
    assert.ok(
      report.issues.some((i) => i.field === 'cash.balance_after_units' && i.differenceUnits === '58'),
    );
    assert.ok(report.issues.some((i) => i.field === 'cash.balance_units' && i.differenceUnits === '59'));
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM customers').all()), before);
  } finally {
    db.close();
  }
});

test('purchase rounding and carried balances are recomputed from raw inputs, not cached totals', () => {
  const { db, admin } = collectionFixture();
  try {
    const page = listPurchases(db, admin, 'al_bayan', null, null);
    createPurchaseEntry(
      db,
      admin,
      'al_bayan',
      {
        requestId: 'reconcile-corrupt-purchase',
        expectedDayVersion: page.day.version,
        itemCode: 'custom',
        itemLabel: 'test',
        egpValueUnits: 11,
        calculationMode: 'divide',
        exchangeRate: '2',
        paidUnits: 2,
        vodafoneConsumedUnits: 0,
      },
      'test',
    );
    db.exec(
      'UPDATE purchase_entries SET result_units=5,remaining_units=3; UPDATE purchase_days SET today_result_units=5,total_debt_units=3;',
    );
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'mismatch');
    assert.ok(
      report.issues.some(
        (i) => i.field === 'purchase.result_units' && i.expected === '6' && i.actual === '5',
      ),
    );
    assert.ok(report.issues.some((i) => i.field === 'purchase_day.total_debt_units' && i.expected === '4'));
  } finally {
    db.close();
  }
});

test('read-only CLI preserves schema and rows, returns machine-readable status and never overwrites a report or input', () => {
  const root = mkdtempSync(join(tmpdir(), 'financial-reconcile-'));
  const path = join(root, 'test.sqlite'),
    output = join(root, 'report.json');
  const { db } = collectionFixture(path);
  db.close();
  try {
    const before = readFileSync(path);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [resolve('scripts/reconcile-financials.ts'), ...args], {
        encoding: 'utf8',
      });
    const result = run(path, output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'matched');
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).reportVersion, 1);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(run(path, output).status, 1);
    assert.equal(run(path, path).status, 1);
    assert.equal(run(join(root, 'missing.sqlite')).status, 1);
    const altered = new DatabaseSync(path);
    altered.exec(
      'UPDATE customers SET current_balance_units=111 WHERE id=(SELECT id FROM customers WHERE system_link_key IS NULL LIMIT 1)',
    );
    altered.close();
    assert.equal(run(path).status, 2);
    writeFileSync(join(root, 'empty.sqlite'), '');
    assert.equal(run(join(root, 'empty.sqlite')).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('all values use one WAL snapshot even if a second connection commits during the check', () => {
  const root = mkdtempSync(join(tmpdir(), 'financial-snapshot-'));
  const path = join(root, 'test.sqlite');
  const { db, ids } = collectionFixture(path);
  const writer = new DatabaseSync(path);
  const original = db.prepare.bind(db);
  let changed = false;
  try {
    db.prepare = (sql: string) => {
      if (!changed && sql === 'SELECT id FROM organizations ORDER BY id') {
        writer.prepare('UPDATE customers SET current_balance_units=999 WHERE id=?').run(ids[0]);
        changed = true;
      }
      return original(sql);
    };
    assert.equal(
      reconcileFinancials(db).status,
      'matched',
      'The report must use the snapshot established before the concurrent commit.',
    );
    assert.equal(changed, true);
    assert.equal(
      reconcileFinancials(db).status,
      'mismatch',
      'The next run must see the newer committed mismatch.',
    );
  } finally {
    writer.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('large SQLite integers and multi-organization totals stay exact and never mix currencies or tenants', () => {
  const { db, ids } = collectionFixture();
  try {
    db.exec(`INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('reconcile-org','Other organization','reconcile-org',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO branches(id,organization_id,code,name,created_at,updated_at) VALUES('reconcile-branch','reconcile-org','MAIN','Other branch',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      VALUES('reconcile-user','reconcile-user','Other admin','test','admin','reconcile-org','reconcile-branch',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
    const other = {
      id: 'reconcile-user',
      username: 'reconcile-user',
      displayName: 'Other admin',
      role: 'admin' as const,
      organizationId: 'reconcile-org',
      homeBranchId: 'reconcile-branch',
      mustChangePassword: false,
      permissions: new Set<string>(),
      sessionTokenHash: '',
      csrfHash: '',
    };
    createCustomer(
      db,
      other,
      { name: 'Other org account', openingBalance: 7, requestId: 'other-org-opening' },
      'test',
    );
    const large = 9_007_199_254_740_993n;
    db.prepare('UPDATE customer_cycles SET initial_balance_units=? WHERE customer_id=?').run(
      large - 100n,
      ids[0],
    );
    db.prepare('UPDATE customers SET current_balance_units=? WHERE id=?').run(large, ids[0]);
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'mismatch');
    assert.ok(report.issues.some((i) => i.code === 'UNSAFE_DISPLAY_AMOUNT' && i.actual === String(large)));
    const own = report.organizations.find((o) => o.organizationId === 'org-default')!;
    const foreign = report.organizations.find((o) => o.organizationId === 'reconcile-org')!;
    assert.equal(
      own.sections.find((s) => s.section === 'customer_debts')!.expectedNetUnits,
      String(large + 200n),
    );
    assert.equal(foreign.sections.find((s) => s.section === 'customer_debts')!.expectedNetUnits, '7');
    assert.equal(foreign.activeCashLyd, '0');
  } finally {
    db.close();
  }
});

test('a forged ledger amount is detected even when its cached balance has been changed to agree', () => {
  const { db, admin, ids } = collectionFixture();
  try {
    const posted = addCustomerTransaction(
      db,
      admin,
      ids[0],
      {
        requestId: 'reconcile-forged-ledger',
        expectedVersion: 1,
        type: 'debt',
        inputValue: 11,
        calculationMode: 'divide',
        factor: '2',
      },
      'test',
    );
    const id = String((posted.body.transaction as { id: string }).id);
    db.prepare('UPDATE debt_transactions SET amount_units=6 WHERE id=?').run(id);
    db.prepare('UPDATE customers SET current_balance_units=106 WHERE id=?').run(ids[0]);
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'mismatch');
    assert.ok(
      report.issues.some(
        (issue) =>
          issue.entityId === id &&
          issue.field === 'ledger.calculated_amount_units' &&
          issue.expected === '5' &&
          issue.actual === '6',
      ),
    );
  } finally {
    db.close();
  }
});

test('negative EGP credit and its conversion preserve signed nearest rounding independently', () => {
  const { db, admin } = collectionFixture();
  try {
    const created = createCustomer(
      db,
      admin,
      { requestId: 'negative-reconcile-account', name: 'Negative EGP', openingBalance: 10 },
      'test',
      'depositEgp',
    );
    const id = String((created.body.customer as { id: string }).id);
    addCustomerTransaction(
      db,
      admin,
      id,
      {
        requestId: 'negative-reconcile-payment',
        expectedVersion: 1,
        type: 'payment',
        paymentMode: 'partial',
        inputValue: 11,
      },
      'test',
      'depositEgp',
    );
    setEgyptianDepositRate(db, admin, '2');
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'matched');
    assert.equal(report.organizations[0].egyptianConvertedLyd, '-1');
    const section = report.organizations[0].sections.find(
      (section) => section.section === 'egyptian_deposits',
    )!;
    assert.equal(section.expectedDebtUnits, '0');
    assert.equal(section.expectedCreditUnits, '1');
    assert.equal(section.expectedNetUnits, '-1');
  } finally {
    db.close();
  }
});
