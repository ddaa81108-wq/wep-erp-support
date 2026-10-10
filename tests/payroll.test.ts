import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import {
  confirmCollectionPayrollEntry,
  createCollectionPayrollEntry,
  listCollectionPayroll,
} from '../src/server/domain/collectionPayroll.ts';
import { listNotifications } from '../src/server/domain/notifications.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const databases: AppDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });

function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const now = new Date().toISOString();
  const addUser = db.prepare(`INSERT INTO users(
    id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at,is_active
  ) VALUES(?,?,?,?,?,?,?,?,?,1)`);
  addUser.run('payroll-admin', 'payroll-admin', 'مدير المرتبات', 'hash', 'admin', 'org-default', 'branch-main', now, now);
  addUser.run('payroll-employee', 'payroll-employee', 'موظف المرتبات', 'hash', 'employee', 'org-default', 'branch-main', now, now);
  db.prepare(`INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)`)
    .run('payroll-employee', 'collections.read', now);
  const base = {
    organizationId: 'org-default', homeBranchId: 'branch-main', mustChangePassword: false,
    sessionTokenHash: 'session', csrfHash: 'csrf', permissions: new Set<string>(['collections.read']),
  };
  const admin: AuthenticatedUser = { ...base, id: 'payroll-admin', username: 'payroll-admin', displayName: 'مدير المرتبات', role: 'admin', permissions: new Set() };
  const employee: AuthenticatedUser = { ...base, id: 'payroll-employee', username: 'payroll-employee', displayName: 'موظف المرتبات', role: 'employee' };
  return { db, admin, employee };
}

test('collection payroll keeps salary arithmetic, admin-only writes, employee confirmation, and rollover data', () => {
  const { db, admin, employee } = setup();
  const initial = listCollectionPayroll(db, employee);
  assert.equal(initial.employees[0]?.baseSalaryUnits, 3500);
  assert.equal(initial.employees[0]?.remainingUnits, 3500);
  const withdrawal = createCollectionPayrollEntry(db, admin, {
    employeeUserId: employee.id, kind: 'withdrawal', amountUnits: 100, reason: 'سلفة', requestId: 'payroll-withdrawal-1',
  }, 'payroll-correlation-1');
  const commission = createCollectionPayrollEntry(db, admin, {
    employeeUserId: employee.id, kind: 'commission', amountUnits: 500, reason: 'مكافأة', requestId: 'payroll-commission-1',
  }, 'payroll-correlation-2');
  const current = listCollectionPayroll(db, employee).employees[0]!;
  assert.equal(current.withdrawalsUnits, 100);
  assert.equal(current.commissionsUnits, 500);
  assert.equal(current.remainingUnits, 3900);
  assert.equal(current.entries.length, 2);
  assert.equal(confirmCollectionPayrollEntry(db, employee, String(withdrawal.id), 'payroll-correlation-3').replayed, undefined);
  assert.equal(confirmCollectionPayrollEntry(db, employee, String(withdrawal.id), 'payroll-correlation-4').replayed, true);
  assert.throws(() => createCollectionPayrollEntry(db, employee, {
    employeeUserId: employee.id, kind: 'withdrawal', amountUnits: 1, reason: 'محاولة', requestId: 'payroll-forbidden-1',
  }, 'payroll-correlation-5'));
  const employeeNotices = listNotifications(db, employee, new URL('https://localhost/api/notifications'));
  assert.equal(employeeNotices.items.length, 2);
  const adminNotices = listNotifications(db, admin, new URL('https://localhost/api/notifications'));
  assert.ok(adminNotices.items.some((item) => item.action === 'collection.payroll.entry.confirm'));
  assert.equal(commission.replayed, undefined);
});
