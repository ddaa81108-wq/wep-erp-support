import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import {
  addTreasuryCashEntry,
  treasuryCashLedger,
  treasuryDashboard,
} from '../src/server/domain/treasury.ts';
import { correctTreasuryCashEntry } from '../src/server/domain/treasuryCorrections.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import { HttpError } from '../src/server/http/errors.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createEmergencyBackup,validateBackupFile } from '../src/server/domain/emergencyBackup.ts';

function fixture(path = ':memory:') {
  const db = openDatabase(path),
    admin = fixtureAdmin(db);
  const entry = addTreasuryCashEntry(
    db,
    admin,
    { requestId: randomUUID(), expectedVersion: 0, direction: 'in', amountUnits: 5000, description: 'الأصل' },
    'test',
  ).entry;
  const input = (extra: Record<string, unknown> = {}) => ({
    requestId: randomUUID(),
    expectedVersion: treasuryDashboard(db, admin.organizationId).cashVersion,
    expectedEntryRevision: 0,
    direction: 'in',
    amountUnits: 500,
    description: 'الصحيح',
    reason: 'خطأ في القيمة',
    ...extra,
  });
  return { db, admin, entry, input };
}
const snapshot = (db: AppDatabase) =>
  JSON.stringify(
    [
      'treasury_cash_accounts',
      'treasury_cash_entries',
      'treasury_cash_corrections',
      'treasury_cash_requests',
      'audit_log',
      'event_log',
      'financial_ledger_entries',
    ].map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
  );
const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;

test('cash corrections apply only differences, preserve originals/closings and replay without duplicate money', () => {
  const { db, admin, entry, input } = fixture();
  try {
    const original = db.prepare('SELECT * FROM treasury_cash_entries WHERE id=?').get(entry.id);
    db.prepare(
      'INSERT INTO daily_financial_closings(organization_id,business_date,scheduled_at,captured_at,snapshot_json) VALUES(?,?,?,?,?)',
    ).run(
      admin.organizationId,
      '2026-11-01',
      '2026-11-02T03:00:00Z',
      '2026-11-02T03:00:00Z',
      '{"activeCashUnits":5000}',
    );
    const closing = db.prepare('SELECT * FROM daily_financial_closings').all();
    const body = input();
    const corrected = correctTreasuryCashEntry(db, admin, entry.id, body, 'test');
    assert.equal(corrected.deltaUnits, -4500);
    assert.equal(corrected.activeCashUnits, 500);
    const after = snapshot(db);
    assert.equal(correctTreasuryCashEntry(db, admin, entry.id, body, 'retry').replayed, true);
    assert.equal(snapshot(db), after);
    assert.throws(
      () => correctTreasuryCashEntry(db, admin, entry.id, { ...body, amountUnits: 501 }, 'test'),
      code('REQUEST_ID_REUSED'),
    );
    const second = correctTreasuryCashEntry(
      db,
      admin,
      entry.id,
      input({ expectedEntryRevision: 1, amountUnits: 700 }),
      'test',
    );
    assert.equal(second.deltaUnits, 200);
    assert.equal(second.activeCashUnits, 700);
    const reversed = correctTreasuryCashEntry(
      db,
      admin,
      entry.id,
      input({ expectedEntryRevision: 2, amountUnits: 700, direction: 'out' }),
      'test',
    );
    assert.equal(reversed.deltaUnits, -1400);
    assert.equal(reversed.activeCashUnits, -700);
    const count = db.prepare('SELECT COUNT(*) n FROM treasury_cash_entries').get()!.n;
    const described = correctTreasuryCashEntry(
      db,
      admin,
      entry.id,
      input({ expectedEntryRevision: 3, amountUnits: 700, direction: 'out', description: 'بيان مصحح' }),
      'test',
    );
    assert.equal(described.deltaUnits, 0);
    assert.equal(described.adjustmentEntryId, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_cash_entries').get()!.n, count);
    assert.deepEqual(db.prepare('SELECT * FROM treasury_cash_entries WHERE id=?').get(entry.id), original);
    assert.deepEqual(db.prepare('SELECT * FROM daily_financial_closings').all(), closing);
    const ledger = treasuryCashLedger(db, admin.organizationId, new URL('http://local'));
    const source = ledger.items.find((item) => item.id === entry.id)!;
    assert.equal(source.amountUnits, 5000);
    assert.equal(source.correction?.amountUnits, 700);
    assert.equal(source.correction?.revision, 4);
    assert.equal(
      ledger.items.find((item) => item.id === corrected.adjustmentEntryId)?.correctionOf?.id,
      entry.id,
    );
    const report = reconcileFinancials(db);
    assert.equal(report.status, 'matched', JSON.stringify(report));
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='treasury.cash.correct'").get()!.n,
      4,
    );
  } finally {
    db.close();
  }
});

test('cash correction authorization, stale versions, invalid values and adjustment targeting cannot write', () => {
  const { db, admin, entry, input } = fixture();
  try {
    const before = snapshot(db);
    const attempts: [() => unknown, string][] = [
      [
        () =>
          correctTreasuryCashEntry(
            db,
            { ...admin, role: 'employee', permissions: new Set(['treasury.write']) },
            entry.id,
            input(),
            'test',
          ),
        'PERMISSION_DENIED',
      ],
      [
        () => correctTreasuryCashEntry(db, { ...admin, organizationId: 'other' }, entry.id, input(), 'test'),
        'NOT_FOUND',
      ],
      [
        () => correctTreasuryCashEntry(db, admin, entry.id, input({ expectedVersion: 0 }), 'test'),
        'VERSION_CONFLICT',
      ],
      [
        () => correctTreasuryCashEntry(db, admin, entry.id, input({ expectedEntryRevision: 1 }), 'test'),
        'CASH_CORRECTION_CHANGED',
      ],
      [
        () => correctTreasuryCashEntry(db, admin, entry.id, input({ amountUnits: 0 }), 'test'),
        'INVALID_CASH_AMOUNT',
      ],
      [
        () => correctTreasuryCashEntry(db, admin, entry.id, input({ reason: '   ' }), 'test'),
        'CASH_CORRECTION_REASON_REQUIRED',
      ],
      [
        () =>
          correctTreasuryCashEntry(
            db,
            admin,
            entry.id,
            input({ direction: 'out', amountUnits: Number.MAX_SAFE_INTEGER }),
            'test',
          ),
        'TREASURY_TOTAL_OUT_OF_RANGE',
      ],
      [
        () =>
          correctTreasuryCashEntry(
            db,
            admin,
            entry.id,
            input({ amountUnits: 5000, description: 'الأصل' }),
            'test',
          ),
        'CASH_CORRECTION_UNCHANGED',
      ],
    ];
    for (const [attempt, error] of attempts) {
      assert.throws(attempt, code(error));
      assert.equal(snapshot(db), before);
    }
    const corrected = correctTreasuryCashEntry(db, admin, entry.id, input(), 'test');
    const after = snapshot(db);
    assert.throws(
      () => correctTreasuryCashEntry(db, admin, corrected.adjustmentEntryId!, input(), 'test'),
      code('CASH_ADJUSTMENT_NOT_EDITABLE'),
    );
    assert.throws(
      () => correctTreasuryCashEntry(db, admin, entry.id, input(), 'test'),
      code('CASH_CORRECTION_CHANGED'),
    );
    assert.equal(snapshot(db), after);
  } finally {
    db.close();
  }
});

test('failed correction rolls back its cash difference, general ledger and request/audit records together', () => {
  const { db, admin, entry, input } = fixture();
  try {
    const before = snapshot(db);
    db.exec(
      "CREATE TRIGGER fail_correction BEFORE INSERT ON treasury_cash_corrections BEGIN SELECT RAISE(ABORT,'test failure'); END",
    );
    assert.throws(() => correctTreasuryCashEntry(db, admin, entry.id, input(), 'test'), /test failure/);
    assert.equal(snapshot(db), before);
  } finally {
    db.close();
  }
});

test('schema 58 upgrade and reopen preserve schema 57 cash history and balances', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cash-upgrade-')),
    path = join(directory, 'test.sqlite');
  try {
    const { db } = fixture(path);
    const entries = db.prepare('SELECT * FROM treasury_cash_entries').all();
    const balance = db.prepare('SELECT * FROM treasury_cash_accounts').all();
    db.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('DROP TABLE treasury_cash_corrections; DELETE FROM schema_migrations WHERE version=58');
    legacy.close();
    for (let i = 0; i < 2; i++) {
      const upgraded = openDatabase(path);
      assert.deepEqual(upgraded.prepare('SELECT * FROM treasury_cash_entries').all(), entries);
      assert.deepEqual(upgraded.prepare('SELECT * FROM treasury_cash_accounts').all(), balance);
      assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=58').get()!.n, 1);
      assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM treasury_cash_corrections').get()!.n, 0);
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('backup roundtrip retains corrections, original cash history and replay protection',async()=>{
  const {db,admin,entry,input}=fixture();
  const directory=mkdtempSync(join(tmpdir(),'cash-correction-backup-'));
  try {
    const body=input();correctTreasuryCashEntry(db,admin,entry.id,body,'test');
    const backup=await createEmergencyBackup(db,{...admin,isOwner:true});
    const path=join(directory,'restored.sqlite');writeFileSync(path,Buffer.from(backup.database,'base64'));
    validateBackupFile(path,admin.organizationId);
    const restored=openDatabase(path);
    try {
      assert.deepEqual(restored.prepare('SELECT * FROM treasury_cash_entries ORDER BY sequence').all(),db.prepare('SELECT * FROM treasury_cash_entries ORDER BY sequence').all());
      assert.deepEqual(restored.prepare('SELECT * FROM treasury_cash_corrections').all(),db.prepare('SELECT * FROM treasury_cash_corrections').all());
      assert.equal(correctTreasuryCashEntry(restored,admin,entry.id,body,'retry').replayed,true);
      assert.equal(treasuryDashboard(restored,admin.organizationId).activeCashUnits,500);
      assert.equal(reconcileFinancials(restored).issueCount,0);
    }finally{restored.close();}
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP cash correction requires administration, CSRF and preserves replay after a lost response', async () => {
  const { db, admin, entry, input } = fixture();
  const server = createApp(
    db,
    loadConfig({ databasePath: ':memory:', internetRequired: false, secureCookie: false, publicOrigin: '' }),
  );
  try {
    await listen(server, '127.0.0.1', 0);
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    db.prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      SELECT 'cash-employee','cash-employee','Employee',password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`,
    ).run(admin.id);
    db.prepare(
      "INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('cash-employee','treasury.write',1,?)",
    ).run(new Date().toISOString());
    const employee = createSession(db, 'cash-employee', '1', 12),
      session = createSession(db, admin.id, '1', 12);
    const post = (token: string, csrf: string, body: unknown) =>
      fetch(base + `/api/treasury/cash-entries/${entry.id}/corrections`, {
        method: 'POST',
        headers: {
          cookie: `abdo_session=${token}`,
          'X-CSRF-Token': csrf,
          'X-Client-Api-Version': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const body = input();
    assert.equal((await post(employee.token, employee.csrfToken, body)).status, 403);
    assert.equal((await post(session.token, 'invalid', body)).status, 403);
    const saved = await post(session.token, session.csrfToken, body);
    assert.equal(saved.status, 200, await saved.clone().text());
    const before = snapshot(db);
    const replay = await post(session.token, session.csrfToken, body);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.replayed, true);
    assert.equal(snapshot(db), before);
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
