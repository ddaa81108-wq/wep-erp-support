import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createCollectionPayrollEntry, confirmCollectionPayrollEntry, listCollectionPayroll } from '../src/server/domain/collectionPayroll.ts';
import { cancelCollectionPayrollEntry } from '../src/server/domain/collectionPayrollCancellation.ts';
import { HttpError } from '../src/server/http/errors.ts';

test('payroll cancellation reverses withdrawal/commission once, preserves history and is admin-only', () => {
  const { db, admin, collector, other } = collectionFixture();
  try {
    const create = (kind: 'withdrawal' | 'commission', amountUnits: number) => createCollectionPayrollEntry(db, admin, {
      employeeUserId: collector.id, kind, amountUnits, reason: 'حركة اختبار', requestId: `cancel-${kind}`,
    }, 'test');
    const withdrawal = create('withdrawal', 100), commission = create('commission', 500);
    const snapshot = () => listCollectionPayroll(db, collector, true).employees[0]!;
    assert.equal(snapshot().remainingUnits, 3900);
    for (const actor of [collector, other]) assert.throws(() => cancelCollectionPayrollEntry(db, actor, withdrawal.id, 'test'), (e: unknown) => e instanceof HttpError && e.status === 403);
    assert.throws(() => cancelCollectionPayrollEntry(db, { ...admin, organizationId: 'other-org' }, withdrawal.id, 'test'), (e: unknown) => e instanceof HttpError && e.status === 404);
    cancelCollectionPayrollEntry(db, admin, withdrawal.id, 'test');
    assert.equal(snapshot().withdrawalsUnits, 0);
    assert.equal(snapshot().remainingUnits, 4000);
    assert.throws(() => confirmCollectionPayrollEntry(db, collector, withdrawal.id, 'test'), (e: unknown) => e instanceof HttpError && e.code === 'PAYROLL_ENTRY_CANCELLED');
    confirmCollectionPayrollEntry(db, collector, commission.id, 'test');
    cancelCollectionPayrollEntry(db, admin, commission.id, 'test');
    for (let i = 0; i < 20; i++) assert.equal(cancelCollectionPayrollEntry(db, admin, commission.id, 'repeat').replayed, true);
    assert.equal(snapshot().commissionsUnits, 0);
    assert.equal(snapshot().remainingUnits, 3500);
    assert.equal(snapshot().entries.length, 2);
    assert.equal(listCollectionPayroll(db, collector).employees[0]!.entries.length, 0, 'Legacy consumers receive only effective entries');
    assert.equal(listCollectionPayroll(db, collector).employees[0]!.remainingUnits, 3500);
    const entry = db.prepare('SELECT * FROM collection_payroll_entries WHERE id=?').get(commission.id) as Record<string, unknown>;
    assert.ok(entry.confirmed_at && entry.cancelled_at);
    assert.equal(entry.amount_units, 500);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.payroll.entry.cancel'").get() as { n: number }).n, 2);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM notifications WHERE action='collection.payroll.entry.cancel'").get() as { n: number }).n, 2);
    assert.equal(create('commission', 500).replayed, true, 'Retry original create cannot resurrect a cancelled entry');
    assert.equal(snapshot().remainingUnits, 3500);
  } finally { db.close(); }
});

test('payroll cancellation repairs consecutive stored monthly carry and rolls back atomically', () => {
  const { db, admin, collector } = collectionFixture();
  try {
    const entry = createCollectionPayrollEntry(db, admin, { employeeUserId: collector.id, kind: 'withdrawal', amountUnits: 200, reason: 'اختبار الترحيل', requestId: 'carry-cancel' }, 'test');
    const current = listCollectionPayroll(db, collector).period;
    const [year, month] = current.split('-').map(Number);
    const periodAt = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    db.prepare('UPDATE collection_payroll_months SET period_key=?').run(periodAt(-1));
    const insert = db.prepare('INSERT INTO collection_payroll_months(id,organization_id,employee_user_id,period_key,base_salary_units,opening_carry_units,created_at) VALUES(?,?,?,?,3500,?,?)');
    insert.run('carry-current', admin.organizationId, collector.id, current, 3300, new Date().toISOString());
    insert.run('carry-next', admin.organizationId, collector.id, periodAt(1), 6800, new Date().toISOString());
    db.exec("CREATE TRIGGER fail_cancel BEFORE INSERT ON audit_log WHEN NEW.action='collection.payroll.entry.cancel' BEGIN SELECT RAISE(ABORT,'isolated cancellation failure'); END");
    assert.throws(() => cancelCollectionPayrollEntry(db, admin, entry.id, 'test'), /isolated cancellation failure/);
    assert.equal((db.prepare('SELECT cancelled_at FROM collection_payroll_entries WHERE id=?').get(entry.id) as { cancelled_at: null }).cancelled_at, null);
    assert.equal((db.prepare("SELECT opening_carry_units n FROM collection_payroll_months WHERE id='carry-current'").get() as { n: number }).n, 3300);
    db.exec('DROP TRIGGER fail_cancel');
    cancelCollectionPayrollEntry(db, admin, entry.id, 'test');
    assert.equal((db.prepare("SELECT opening_carry_units n FROM collection_payroll_months WHERE id='carry-current'").get() as { n: number }).n, 3500);
    assert.equal((db.prepare("SELECT opening_carry_units n FROM collection_payroll_months WHERE id='carry-next'").get() as { n: number }).n, 7000);
    assert.equal(listCollectionPayroll(db, collector).employees[0]!.remainingUnits, 7000);
  } finally { db.close(); }
});
