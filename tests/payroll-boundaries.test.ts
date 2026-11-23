import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createCollectionPayrollEntry, listCollectionPayroll, updateCollectionPayrollSalary } from '../src/server/domain/collectionPayroll.ts';
import { cancelCollectionPayrollEntry } from '../src/server/domain/collectionPayrollCancellation.ts';
import { HttpError } from '../src/server/http/errors.ts';

const outOfRange = (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === 'BALANCE_OUT_OF_RANGE';

test('payroll refuses cumulative overflow atomically and preserves valid boundary amounts and replay', () => {
  const { db, admin, collector } = collectionFixture();
  try {
    updateCollectionPayrollSalary(db, admin, collector.id, { baseSalaryUnits: 0 }, 'test');
    const create = (kind: string, amountUnits: number, requestId: string) => createCollectionPayrollEntry(db, admin, {
      employeeUserId: collector.id, kind, amountUnits, reason: 'boundary fixture', requestId,
    }, 'test');
    const counts = () => ['collection_payroll_entries', 'audit_log', 'notifications', 'event_log']
      .map(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
    const max = Number.MAX_SAFE_INTEGER;
    const first = create('commission', max, 'boundary-max-commission');
    assert.equal(listCollectionPayroll(db, collector).employees[0].remainingUnits, max);
    const before = counts();
    assert.throws(() => create('commission', 1, 'boundary-overflow-add'), outOfRange);
    assert.deepEqual(counts(), before);
    assert.equal(create('commission', max, 'boundary-max-commission').id, first.id);
    assert.throws(() => updateCollectionPayrollSalary(db, admin, collector.id, { baseSalaryUnits: 1 }, 'test'), outOfRange);
    assert.deepEqual(counts(), before);
    assert.equal(listCollectionPayroll(db, collector).employees[0].baseSalaryUnits, 0);
    const withdrawal = create('withdrawal', 100, 'boundary-withdrawal');
    updateCollectionPayrollSalary(db, admin, collector.id, { baseSalaryUnits: 100 }, 'test');
    const beforeCancel = counts();
    assert.throws(() => cancelCollectionPayrollEntry(db, admin, withdrawal.id, 'test'), outOfRange);
    assert.deepEqual(counts(), beforeCancel);
    assert.equal(db.prepare('SELECT cancelled_at FROM collection_payroll_entries WHERE id=?').get(withdrawal.id)!.cancelled_at, null);
    assert.equal(listCollectionPayroll(db, collector).employees[0].remainingUnits, max);
    cancelCollectionPayrollEntry(db, admin, first.id, 'test');
    assert.equal(listCollectionPayroll(db, collector).employees[0].remainingUnits, 0);
    // Withdrawals are bounded independently, even when offset by commissions.
    create('withdrawal', max - 100, 'boundary-withdrawal-max');
    assert.throws(() => create('withdrawal', 1, 'boundary-withdrawal-over'), outOfRange);
  } finally { db.close(); }
});

test('historical payroll aggregates beyond SQLite/JS integer ranges return a controlled error', () => {
  const { db, admin, collector } = collectionFixture();
  try {
    updateCollectionPayrollSalary(db, admin, collector.id, { baseSalaryUnits: 0 }, 'test');
    const entry = createCollectionPayrollEntry(db, admin, { employeeUserId: collector.id, kind: 'commission', amountUnits: 1, reason: 'legacy fixture', requestId: 'legacy-boundary-fixture' }, 'test');
    db.prepare('UPDATE collection_payroll_entries SET amount_units=? WHERE id=?').run(Number.MAX_SAFE_INTEGER, entry.id);
    db.exec(`INSERT INTO collection_payroll_entries SELECT 'legacy-extra',organization_id,month_id,employee_user_id,entry_kind,amount_units,reason,'legacy-extra-key',created_by_user_id,created_at,confirmed_at,confirmed_by_user_id,cancelled_at,cancelled_by_user_id FROM collection_payroll_entries LIMIT 1`);
    assert.throws(() => listCollectionPayroll(db, collector), outOfRange);
    cancelCollectionPayrollEntry(db, admin, 'legacy-extra', 'test');
    assert.equal(listCollectionPayroll(db, collector).employees[0].remainingUnits, Number.MAX_SAFE_INTEGER);
  } finally { db.close(); }
});
