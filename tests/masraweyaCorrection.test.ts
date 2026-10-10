import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import {
  finalizeMasraweyaDay,
  getMasraweyaDay,
  saveMasraweyaDay,
  setMasraweyaDayCorrection,
} from '../src/server/domain/masraweya.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const databases: AppDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });

function setup() {
  const db = openDatabase(':memory:'); databases.push(db);
  const now = new Date().toISOString();
  const add = db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at,is_owner)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  add.run('mas-owner', 'mas-owner', 'المدير الأعلى', 'hash', 'admin', 'org-default', 'branch-main', now, now, 1);
  add.run('mas-admin', 'mas-admin', 'إداري المصراوية', 'hash', 'admin', 'org-default', 'branch-main', now, now, 0);
  const base = { organizationId: 'org-default', homeBranchId: 'branch-main', mustChangePassword: false, permissions: new Set<string>(['masraweya.write']), sessionTokenHash: 's', csrfHash: 'c' };
  const owner: AuthenticatedUser = { ...base, id: 'mas-owner', username: 'mas-owner', displayName: 'المدير الأعلى', role: 'admin', isOwner: true };
  const admin: AuthenticatedUser = { ...base, id: 'mas-admin', username: 'mas-admin', displayName: 'إداري المصراوية', role: 'admin', isOwner: false };
  return { db, owner, admin };
}

test('Masraweya correction is owner-opened, admin-editable, audited, and updates later carry preview', () => {
  const { db, owner, admin } = setup();
  const saved = saveMasraweyaDay(db, owner, {
    businessDate: '2026-10-07', expectedVersion: 0, previousValueUnits: 0, purchasesUnits: 1000,
    entries: [{ valueUnits: 100, commissionUnits: 0 }],
  }, 'mas-correction-1');
  const finalized = finalizeMasraweyaDay(db, owner, { businessDate: '2026-10-07', expectedVersion: saved.version }, 'mas-correction-2');
  const nextBefore = getMasraweyaDay(db, owner.organizationId, '2026-10-08');
  assert.equal(nextBefore.carryValueUnits, 900);
  assert.throws(() => setMasraweyaDayCorrection(db, admin, { businessDate: '2026-10-07', expectedVersion: finalized.version, open: true, reason: 'تصحيح' }, 'mas-correction-3'));
  const opened = setMasraweyaDayCorrection(db, owner, { businessDate: '2026-10-07', expectedVersion: finalized.version, open: true, reason: 'تصحيح القيمة' }, 'mas-correction-4');
  const corrected = saveMasraweyaDay(db, admin, {
    businessDate: '2026-10-07', expectedVersion: opened.version, previousValueUnits: 0, purchasesUnits: 1200,
    entries: [{ valueUnits: 100, commissionUnits: 0 }],
  }, 'mas-correction-5');
  assert.equal(getMasraweyaDay(db, owner.organizationId, '2026-10-08').carryValueUnits, 1100);
  const closed = finalizeMasraweyaDay(db, admin, { businessDate: '2026-10-07', expectedVersion: corrected.version }, 'mas-correction-6');
  assert.equal(closed.correctionOpen, false);
  assert.equal(closed.finalizedByName, 'إداري المصراوية');
});
