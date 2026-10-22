import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { addCustomerTransaction, cancelCustomerTransaction } from '../src/server/domain/customerTransactions.ts';
import type { DebtPartyKind } from '../src/server/domain/customerProfiles.ts';
import { HttpError } from '../src/server/http/errors.ts';
import { currentBusinessDate } from '../src/server/domain/reports/businessDates.ts';
import { addTreasuryCashEntry } from '../src/server/domain/treasury.ts';
import { getMasraweyaDay, saveMasraweyaDay } from '../src/server/domain/masraweya.ts';
import { createPurchaseEntry } from '../src/server/domain/purchaseEntryCommands.ts';
import { listPurchases } from '../src/server/domain/purchaseQueries.ts';
import { duplicateAwareInput, confirmDuplicate, answerDuplicate, cancelDuplicatePrompts } from '../src/client/components/duplicatePrompt.ts';
import { createUnlinkedCollectionReceipt } from '../src/server/domain/collections.ts';
import { createCollectionPayrollEntry } from '../src/server/domain/collectionPayroll.ts';

const duplicate = (error: unknown) => error instanceof HttpError && error.code === 'DUPLICATE_SAME_WORKDAY';
function employeeFixture(db: ReturnType<typeof openDatabase>, admin: ReturnType<typeof fixtureAdmin>) {
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
    VALUES('duplicate-employee','duplicate-employee','Duplicate Employee','test','employee',?,?,?,?)`)
    .run(admin.organizationId, admin.homeBranchId, new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('duplicate-employee','collections.read',1,?)`)
    .run(new Date().toISOString());
  return {...admin, id: 'duplicate-employee', role: 'employee' as const, permissions: new Set(['collections.read', 'collections.write'])};
}

test('employee receipts and payroll warn in their own place and preserve explicit override', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const employee = employeeFixture(db, admin);
    const receipt = {checkDuplicate: true, requestId: 'receipt-original', customerName: 'نفس العميل', amountUnits: 100};
    createUnlinkedCollectionReceipt(db, employee, receipt, 'test');
    const next = {...receipt, requestId: 'receipt-repeated'};
    assert.throws(() => createUnlinkedCollectionReceipt(db, employee, next, 'test'), duplicate);
    createUnlinkedCollectionReceipt(db, employee, {...next, allowDuplicate: true}, 'test');
    createUnlinkedCollectionReceipt(db, employee, {...receipt, requestId: 'receipt-another', customerName: 'عميل آخر'}, 'test');
    const payroll = {checkDuplicate: true, requestId: 'payroll-original', employeeUserId: employee.id, kind: 'withdrawal', amountUnits: 50, reason: 'سلفة'};
    createCollectionPayrollEntry(db, admin, payroll, 'test');
    assert.throws(() => createCollectionPayrollEntry(db, admin, {...payroll, requestId: 'payroll-repeated'}, 'test'), duplicate);
    createCollectionPayrollEntry(db, admin, {...payroll, requestId: 'payroll-approved', allowDuplicate: true}, 'test');
    createCollectionPayrollEntry(db, admin, {...payroll, requestId: 'payroll-different', kind: 'commission'}, 'test');
  } finally { db.close(); }
});
for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as DebtPartyKind[]) {
  test(`${kind}: same-day warning is scoped, advisory, idempotent, and excludes cancelled/past entries`, () => {
    const db = openDatabase(':memory:');
    try {
      const actor = fixtureAdmin(db);
      const account = (name: string) => (createCustomer(db, actor, { name, openingBalance: 0, requestId: `create-${name}` }, 'test', kind).body as {customer: {id: string}}).customer.id;
      const id = account('first');
      const other = account('other');
      const body = { checkDuplicate: true, expectedVersion: 1, requestId: 'entry-first', type: 'debt', inputValue: 17, calculationMode: 'direct', date: `${currentBusinessDate()}T12:00:00Z` };
      addCustomerTransaction(db, actor, id, body, 'test', kind);
      const next = { ...body, expectedVersion: 2, requestId: 'entry-second' };
      assert.throws(() => addCustomerTransaction(db, actor, id, next, 'test', kind), duplicate);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions WHERE customer_id=?').get(id)!.n, 1);
      addCustomerTransaction(db, actor, other, { ...body, requestId: 'entry-other' }, 'test', kind);
      const allowed = addCustomerTransaction(db, actor, id, { ...next, allowDuplicate: true }, 'test', kind);
      // A retry with the original body remains the same committed operation.
      assert.equal(addCustomerTransaction(db, actor, id, next, 'test', kind).replayed, true);
      const transaction = (allowed.body as {transaction: {id: string}}).transaction;
      cancelCustomerTransaction(db, actor, id, transaction.id, {requestId: 'cancel-entry', expectedVersion: 3}, 'test', kind);
      db.prepare("UPDATE debt_transactions SET transaction_date='2020-01-01T12:00:00Z' WHERE customer_id=? AND transaction_status='posted'").run(id);
      addCustomerTransaction(db, actor, id, {...next, expectedVersion: 4, requestId: 'after-old-entry'}, 'test', kind);
    } finally { db.close(); }
  });
}

test('treasury checks the direction and current local day', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const body = { checkDuplicate: true, requestId: 'cash-first', expectedVersion: 0, direction: 'in', amountUnits: 50 };
    addTreasuryCashEntry(db, actor, body, 'test');
    assert.throws(() => addTreasuryCashEntry(db, actor, {...body, requestId: 'cash-second', expectedVersion: 1}, 'test'), duplicate);
    addTreasuryCashEntry(db, actor, {...body, requestId: 'cash-outward', expectedVersion: 1, direction: 'out'}, 'test');
  } finally { db.close(); }
});

test('purchases compare only the same merchant and workday, and allow explicit repetition', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const version = (key: string) => listPurchases(db, actor, key, undefined, undefined).day.version;
    const body = {checkDuplicate: true, requestId: 'purchase-first', itemCode: 'banks', egpValueUnits: 100, exchangeRate: 2, calculationMode: 'divide', paidUnits: 0, vodafoneConsumedUnits: 0};
    createPurchaseEntry(db, actor, 'al_bayan', {...body, expectedDayVersion: version('al_bayan')}, 'test');
    const next = {...body, requestId: 'purchase-repeat', expectedDayVersion: version('al_bayan')};
    assert.throws(() => createPurchaseEntry(db, actor, 'al_bayan', next, 'test'), duplicate);
    createPurchaseEntry(db, actor, 'simsim', {...body, requestId: 'purchase-other', expectedDayVersion: version('simsim')}, 'test');
    createPurchaseEntry(db, actor, 'al_bayan', {...next, allowDuplicate: true}, 'test');
  } finally { db.close(); }
});

test('masraweya warns only for new matching rows in the current workday, not unchanged rows', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const day = getMasraweyaDay(db, actor.organizationId);
    const body = {checkDuplicate: true, businessDate: day.businessDate, expectedVersion: day.version, previousValueUnits: day.previousValueUnits, purchasesUnits: 0, entries: [{valueUnits: 20, commissionUnits: 1}, {valueUnits: 20, commissionUnits: 1}]};
    assert.throws(() => saveMasraweyaDay(db, actor, body, 'test'), duplicate);
    const saved = saveMasraweyaDay(db, actor, {...body, allowDuplicate: true}, 'test');
    assert.equal(saveMasraweyaDay(db, actor, {...body, expectedVersion: saved.version}, 'test').replayed, true);
  } finally { db.close(); }
});

test('financial creation opts in; edits and other API calls are untouched, queued prompts resolve separately', async () => {
  const init = {method: 'POST', body: '{}'};
  for (const section of ['customers', 'companies', 'libyan-deposits', 'egyptian-deposits'])
    assert.equal(JSON.parse(String(duplicateAwareInput(`/api/${section}/id/transactions`, init).body)).checkDuplicate, true);
  assert.equal(duplicateAwareInput('/api/customers/id/transactions/id/corrections', init), init);
  const first = confirmDuplicate();
  const second = confirmDuplicate();
  answerDuplicate(false);
  assert.equal(await first, false);
  answerDuplicate(true);
  assert.equal(await second, true);
  const closed = confirmDuplicate();
  cancelDuplicatePrompts();
  assert.equal(await closed, false);
});
