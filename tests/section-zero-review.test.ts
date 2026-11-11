import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig,SCHEMA_VERSION } from '../src/server/config.ts';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { migrations } from '../src/server/db/migrations.ts';
import {
  addCustomerTransaction,
  createCustomer,
  customerSnapshot,
  listCustomers,
  setCustomerPinned,
  updateCustomerDetails,
} from '../src/server/domain/customers.ts';
import { partyProfile, type DebtPartyKind } from '../src/server/domain/customerProfiles.ts';
import { reviewCustomerZero } from '../src/server/domain/customerZeroReview.ts';
import { createSession, type AuthenticatedUser } from '../src/server/security/sessions.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';

const kinds = ['customer', 'company', 'depositLyd', 'depositEgp'] as const;

function employee(database: AppDatabase, id: string, permissions: string[]): AuthenticatedUser {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
     VALUES(?,?,?,?, 'employee','org-default','branch-main',?,?)`,
    )
    .run(id, id, id, 'test-only', now, now);
  return {
    id,
    username: id,
    displayName: id,
    role: 'employee',
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(permissions),
    sessionTokenHash: 'test',
    csrfHash: 'test',
  };
}

function moneyState(database: AppDatabase) {
  return {
    accounts: database
      .prepare(
        `SELECT id,section_key,version,current_balance_units,financial_updated_at,zero_review_pending,
        zero_review_financial_version,zero_reviewed_at,zero_reviewed_by,zero_reviewed_by_name
       FROM customers ORDER BY id`,
      )
      .all(),
    ledger: database.prepare('SELECT * FROM debt_transactions ORDER BY id').all(),
    financialLedger: database.prepare('SELECT * FROM financial_ledger_entries ORDER BY id').all(),
    treasury: database.prepare('SELECT * FROM treasury_cash_entries ORDER BY id').all(),
  };
}

function summaryOf(database: AppDatabase, organizationId: string, kind: DebtPartyKind) {
  return listCustomers(database, new URL('http://test/api/accounts'), organizationId, kind).summary;
}

test('zero review for every account section is financially inert and account-scoped', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const writer = employee(db, 'section-writer', [
      'companies.write',
      'libyan_deposits.write',
      'egyptian_deposits.write',
    ]);
    for (const kind of kinds) {
      const created = createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: `صفر ${kind}`, openingBalance: 0 },
        'test',
        kind,
      );
      const id = (
        created.body.customer as { id: string; balanceUnits: number; zeroReview?: { pending: boolean } }
      ).id;
      const createdCard = created.body.customer as {
        balanceUnits: number;
        zeroReview?: { pending: boolean; financialVersion: number };
      };
      assert.equal(createdCard.balanceUnits, 0);
      assert.equal(createdCard.zeroReview?.pending, true);
      assert.equal(createdCard.zeroReview?.financialVersion, 0);
      const before = customerSnapshot(db, id, admin.organizationId, kind);
      const beforeMoney = moneyState(db);
      const beforeSummary = summaryOf(db, admin.organizationId, kind);
      listCustomers(
        db,
        new URL('http://test/api/accounts?filter=pending-review'),
        admin.organizationId,
        kind,
      );
      customerSnapshot(db, id, admin.organizationId, kind);
      assert.deepEqual(moneyState(db), beforeMoney);

      const actor = kind === 'customer' ? admin : writer;
      const reviewed = reviewCustomerZero(
        db,
        actor,
        id,
        { expectedFinancialVersion: before.zeroReview!.financialVersion },
        'test',
        kind,
      );
      assert.equal(reviewed.status, 200);
      const after = customerSnapshot(db, id, admin.organizationId, kind);
      assert.equal(after.balanceUnits, 0);
      assert.equal(after.version, before.version);
      assert.equal(after.updatedAt, before.updatedAt);
      assert.equal(after.zeroReview?.pending, false);
      assert.equal(after.zeroReview?.financialVersion, before.zeroReview?.financialVersion);
      assert.equal(after.zeroReview?.reviewedByName, actor.displayName);
      assert.equal(
        db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(id).length,
        beforeMoney.ledger.filter((row) => (row as { customer_id: string }).customer_id === id).length,
      );
      const afterSummary = summaryOf(db, admin.organizationId, kind);
      assert.equal(afterSummary.totalDebt, beforeSummary.totalDebt);
      assert.equal(afterSummary.netBalance, beforeSummary.netBalance);
      assert.equal(afterSummary.activeCards, beforeSummary.activeCards);
      assert.equal(afterSummary.pendingReviewCount, beforeSummary.pendingReviewCount - 1);
      const replay = reviewCustomerZero(
        db,
        actor,
        id,
        { expectedFinancialVersion: before.zeroReview!.financialVersion },
        'test',
        kind,
      );
      assert.equal(replay.body.replayed, true);
      assert.equal(
        db
          .prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action=? AND entity_id=?')
          .get(`${partyProfile(kind).entity}.zero_review`, id)?.n,
        1,
      );
      assert.equal(
        db.prepare('SELECT topic FROM event_log WHERE aggregate_id=? ORDER BY sequence DESC LIMIT 1').get(id)
          ?.topic,
        `${partyProfile(kind).event}.changed`,
      );
      setCustomerPinned(db, admin, id, { expectedVersion: after.version, isPinned: true }, 'test', kind);
      updateCustomerDetails(
        db,
        admin,
        id,
        {
          expectedVersion: customerSnapshot(db, id, admin.organizationId, kind).version,
          name: `اسم ${kind}`,
          phone: '',
        },
        'test',
        kind,
      );
      assert.deepEqual(customerSnapshot(db, id, admin.organizationId, kind).zeroReview, after.zeroReview);

      const staleVersion = after.zeroReview!.financialVersion;
      addCustomerTransaction(
        db,
        admin,
        id,
        {
          requestId: randomUUID(),
          expectedVersion: customerSnapshot(db, id, admin.organizationId, kind).version,
          type: 'debt',
          inputValue: 4,
          calculationMode: 'direct',
        },
        'test',
        kind,
      );
      const nonzero = customerSnapshot(db, id, admin.organizationId, kind);
      assert.equal(nonzero.balanceUnits, 4);
      assert.equal(nonzero.zeroReview?.reviewedAt, null);
      assert.equal(nonzero.zeroReview?.pending, false);
      assert.throws(
        () =>
          reviewCustomerZero(
            db,
            actor,
            id,
            { expectedFinancialVersion: nonzero.zeroReview!.financialVersion },
            'test',
            kind,
          ),
        { status: 409, code: 'ZERO_REVIEW_CHANGED' },
      );
      addCustomerTransaction(
        db,
        admin,
        id,
        {
          requestId: randomUUID(),
          expectedVersion: nonzero.version,
          type: 'payment',
          inputValue: 4,
          calculationMode: 'direct',
        },
        'test',
        kind,
      );
      const again = customerSnapshot(db, id, admin.organizationId, kind);
      assert.equal(again.balanceUnits, 0);
      assert.equal(again.zeroReview?.pending, true);
      assert.notEqual(again.zeroReview?.financialVersion, staleVersion);
      const unchanged = moneyState(db);
      assert.throws(
        () => reviewCustomerZero(db, actor, id, { expectedFinancialVersion: staleVersion }, 'test', kind),
        { status: 409, code: 'ZERO_REVIEW_CHANGED' },
      );
      assert.throws(
        () => reviewCustomerZero(db, actor, id, { expectedFinancialVersion: '1' }, 'test', kind),
        { status: 400, code: 'INVALID_REVIEW_VERSION' },
      );
      assert.deepEqual(moneyState(db), unchanged);
      const confirmed = reviewCustomerZero(
        db,
        actor,
        id,
        { expectedFinancialVersion: again.zeroReview!.financialVersion },
        'test',
        kind,
      );
      assert.equal(confirmed.status, 200);
      assert.equal(customerSnapshot(db, id, admin.organizationId, kind).balanceUnits, 0);
    }
  } finally {
    db.close();
  }
});

test('section zero review rejects read-only, cross-section, stale and offline-equivalent failures without writing', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const readers = {
      company: employee(db, 'read-company', ['companies.read']),
      depositLyd: employee(db, 'read-libyan', ['libyan_deposits.read']),
      depositEgp: employee(db, 'read-egyptian', ['egyptian_deposits.read']),
      customer: employee(db, 'read-customer', ['debts.read', 'debts.write']),
    };
    const writers = {
      company: employee(db, 'write-company', ['companies.write']),
      depositLyd: employee(db, 'write-libyan', ['libyan_deposits.write']),
      depositEgp: employee(db, 'write-egyptian', ['egyptian_deposits.write']),
    };
    const ids = new Map<DebtPartyKind, string>();
    for (const kind of kinds) {
      const created = createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: `عزل ${kind}`, openingBalance: 0 },
        'test',
        kind,
      );
      ids.set(kind, (created.body.customer as { id: string }).id);
    }
    const inputFor = (kind: DebtPartyKind) => ({
      expectedFinancialVersion: customerSnapshot(db, ids.get(kind)!, admin.organizationId, kind).zeroReview!
        .financialVersion,
    });
    const unchanged = () => moneyState(db);
    const before = unchanged();
    assert.throws(
      () => reviewCustomerZero(db, readers.customer, ids.get('customer')!, inputFor('customer'), 'test'),
      { status: 403, code: 'PERMISSION_DENIED' },
    );
    for (const kind of ['company', 'depositLyd', 'depositEgp'] as const) {
      assert.throws(
        () => reviewCustomerZero(db, readers[kind], ids.get(kind)!, inputFor(kind), 'test', kind),
        { status: 403, code: 'PERMISSION_DENIED' },
      );
      assert.throws(
        () => reviewCustomerZero(db, readers.customer, ids.get(kind)!, inputFor(kind), 'test', kind),
        { status: 403, code: 'PERMISSION_DENIED' },
      );
    }
    assert.throws(
      () => reviewCustomerZero(db, writers.company, ids.get('customer')!, inputFor('customer'), 'test'),
      { status: 403 },
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          writers.company,
          ids.get('depositLyd')!,
          inputFor('depositLyd'),
          'test',
          'depositLyd',
        ),
      { status: 403 },
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          writers.company,
          ids.get('depositEgp')!,
          inputFor('depositEgp'),
          'test',
          'depositEgp',
        ),
      { status: 403 },
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          writers.depositLyd,
          ids.get('company')!,
          inputFor('company'),
          'test',
          'company',
        ),
      { status: 403 },
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          writers.depositEgp,
          ids.get('depositLyd')!,
          inputFor('depositLyd'),
          'test',
          'depositLyd',
        ),
      { status: 403 },
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          { ...admin, organizationId: 'other-org' },
          ids.get('company')!,
          inputFor('company'),
          'test',
          'company',
        ),
      { status: 404 },
    );
    assert.throws(
      () => reviewCustomerZero(db, admin, ids.get('company')!, inputFor('company'), 'test', 'depositLyd'),
      { status: 404 },
    );
    db.prepare('UPDATE customers SET deleted_at=? WHERE id=?').run(
      new Date().toISOString(),
      ids.get('depositEgp')!,
    );
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          admin,
          ids.get('depositEgp')!,
          { expectedFinancialVersion: 0 },
          'test',
          'depositEgp',
        ),
      { status: 404 },
    );
    db.prepare('UPDATE customers SET zero_review_pending=0 WHERE id=?').run(ids.get('depositLyd')!);
    assert.throws(
      () =>
        reviewCustomerZero(
          db,
          writers.depositLyd,
          ids.get('depositLyd')!,
          { expectedFinancialVersion: 0 },
          'test',
          'depositLyd',
        ),
      { status: 409, code: 'ZERO_REVIEW_NOT_PENDING' },
    );
    const linkedId = String(
      db.prepare("SELECT id FROM customers WHERE system_link_key='masraweya_remainder'").get()!.id,
    );
    assert.equal(customerSnapshot(db, linkedId, admin.organizationId, 'depositEgp').zeroReview, undefined);
    assert.throws(
      () => reviewCustomerZero(db, admin, linkedId, { expectedFinancialVersion: 0 }, 'test', 'depositEgp'),
      { status: 404 },
    );
    assert.equal(summaryOf(db, admin.organizationId, 'depositEgp').pendingReviewCount, 0);
    assert.deepEqual(unchanged().ledger, before.ledger);
    assert.deepEqual(unchanged().treasury, before.treasury);
    assert.deepEqual(unchanged().financialLedger, before.financialLedger);
    const company = customerSnapshot(db, ids.get('company')!, admin.organizationId, 'company');
    assert.equal(company.zeroReview?.pending, true);
    assert.equal(company.balanceUnits, 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE '%.zero_review'").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test('pending section zeros stay in the upper feed until confirmed, then persist after reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'section-zero-review-'));
  const path = join(directory, 'review.sqlite');
  const db = openDatabase(path);
  try {
    const admin = fixtureAdmin(db);
    const writer = employee(db, 'company-writer', ['companies.write']);
    const debt = (
      createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: 'شركة دين', openingBalance: 80 },
        'test',
        'company',
      ).body.customer as { id: string }
    ).id;
    const zero = (
      createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: 'شركة صفر', openingBalance: 0 },
        'test',
        'company',
      ).body.customer as { id: string }
    ).id;
    db.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run(
      '2026-03-01T00:00:00.000Z',
      debt,
    );
    db.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run(
      '2026-04-01T00:00:00.000Z',
      zero,
    );
    const feed = (query = '') =>
      listCustomers(db, new URL('http://test/api/companies?' + query), admin.organizationId, 'company');
    const before = feed();
    assert.deepEqual(
      before.items.map((item) => item.id),
      [zero, debt],
    );
    assert.equal(before.summary.pendingReviewCount, 1);
    assert.equal(before.summary.totalDebt, 80);
    assert.equal(before.summary.netBalance, 80);
    assert.deepEqual(
      feed('filter=pending-review').items.map((item) => item.id),
      [zero],
    );
    const version = before.items[0].zeroReview!.financialVersion;
    reviewCustomerZero(db, writer, zero, { expectedFinancialVersion: version }, 'test', 'company');
    const after = feed('filter=all');
    assert.deepEqual(
      after.items.map((item) => item.id),
      [debt, zero],
    );
    assert.equal(after.summary.pendingReviewCount, 0);
    assert.equal(after.summary.totalDebt, 80);
    assert.equal(after.summary.netBalance, 80);
    assert.equal(after.summary.activeCards, 1);
    assert.equal(feed('filter=pending-review').totalItems, 0);
    assert.equal(customerSnapshot(db, zero, admin.organizationId, 'company').zeroReview?.pending, false);
  } finally {
    db.close();
  }
  const reopened = openDatabase(path);
  try {
    const card = customerSnapshot(
      reopened,
      reopened.prepare("SELECT id FROM customers WHERE name='شركة صفر'").get()!.id as string,
      'org-default',
      'company',
    );
    assert.equal(card.zeroReview?.pending, false);
    assert.equal(card.zeroReview?.reviewedByName, 'company-writer');
    assert.equal(card.balanceUnits, 0);
    assert.equal(
      reopened.prepare('SELECT current_balance_units FROM customers WHERE name=?').get('شركة دين')
        ?.current_balance_units,
      80,
    );
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schema 57 preserves historical zeros, balances and ledger, then new zeros request review', () => {
  const directory = mkdtempSync(join(tmpdir(), 'section-zero-upgrade-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(
      'PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT',
    );
    for (const migration of migrations.filter((item) => item.version <= 56)) {
      legacy.exec('BEGIN IMMEDIATE');
      migration.before?.(legacy);
      legacy.exec(migration.sql);
      migration.after?.(legacy);
      legacy
        .prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(migration.version, migration.name, new Date().toISOString());
      legacy.exec('COMMIT');
    }
    const admin = fixtureAdmin(legacy);
    for (const [kind, name] of [
      ['customer', 'عميل قديم'],
      ['company', 'شركة قديمة'],
      ['depositLyd', 'ليبي قديم'],
      ['depositEgp', 'مصري قديم'],
    ] as const) {
      createCustomer(legacy, admin, { requestId: randomUUID(), name, openingBalance: 0 }, 'test', kind);
    }
    createCustomer(
      legacy,
      admin,
      { requestId: randomUUID(), name: 'شركة دين قديم', openingBalance: 40 },
      'test',
      'company',
    );
    const before = legacy
      .prepare(
        'SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name',
      )
      .all();
    const ledger = legacy.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    assert.equal(
      legacy.prepare("SELECT zero_review_pending FROM customers WHERE name='شركة قديمة'").get()
        ?.zero_review_pending,
      0,
    );
    assert.equal(
      legacy.prepare("SELECT zero_review_pending FROM customers WHERE name='عميل قديم'").get()
        ?.zero_review_pending,
      1,
    );
    legacy.close();
    const upgraded = openDatabase(path);
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            'SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name',
          )
          .all(),
        before,
      );
      assert.deepEqual(upgraded.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), ledger);
      assert.equal(upgraded.prepare('PRAGMA foreign_key_check').all().length, 0);
      const trigger = String(
        upgraded
          .prepare("SELECT sql FROM sqlite_master WHERE name='customer_zero_review_financial_change'")
          .get()?.sql,
      );
      for (const section of ['customer_debts', 'company_debts', 'libyan_deposits', 'egyptian_deposits'])
        assert.match(trigger, new RegExp(section));
      for (const [kind, name] of [
        ['company', 'شركة جديدة'],
        ['depositLyd', 'ليبي جديد'],
        ['depositEgp', 'مصري جديد'],
      ] as const) {
        createCustomer(upgraded, admin, { requestId: randomUUID(), name, openingBalance: 0 }, 'test', kind);
        assert.equal(
          customerSnapshot(
            upgraded,
            upgraded.prepare('SELECT id FROM customers WHERE name=?').get(name)!.id as string,
            admin.organizationId,
            kind,
          ).zeroReview?.pending,
          true,
        );
      }
      assert.equal(
        upgraded.prepare("SELECT current_balance_units FROM customers WHERE name='شركة دين قديم'").get()
          ?.current_balance_units,
        40,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    if (legacy.isOpen) legacy.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP zero-review routes follow the account section and do not approve a stale card', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'section-zero-http-'));
  const db = openDatabase(join(directory, 'http.sqlite'));
  const server = createApp(
    db,
    loadConfig({ databasePath: ':memory:', internetRequired: false, secureCookie: false, publicOrigin: '' }),
  );
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const admin = fixtureAdmin(db);
    const reader = employee(db, 'http-reader', ['companies.read']);
    const writer = employee(db, 'http-writer', ['companies.write']);
    db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(
      reader.id,
      'companies.read',
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(
      writer.id,
      'companies.write',
      new Date().toISOString(),
    );
    const company = (
      createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: 'شركة مسار', openingBalance: 0 },
        'test',
        'company',
      ).body.customer as { id: string }
    ).id;
    const libyan = (
      createCustomer(
        db,
        admin,
        { requestId: randomUUID(), name: 'ليبي مسار', openingBalance: 0 },
        'test',
        'depositLyd',
      ).body.customer as { id: string }
    ).id;
    const version = customerSnapshot(db, company, admin.organizationId, 'company').zeroReview!
      .financialVersion;
    const libyanVersion = customerSnapshot(db, libyan, admin.organizationId, 'depositLyd').zeroReview!
      .financialVersion;
    const sessionFor = (userId: string) => createSession(db, userId, '1', 1);
    const post = async (userId: string, path: string, body: unknown) => {
      const session = sessionFor(userId);
      return fetch(base + path, {
        method: 'POST',
        headers: {
          Cookie: `abdo_session=${session.token}`,
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrfToken,
          'X-Client-Api-Version': '1',
        },
        body: JSON.stringify(body),
      });
    };
    assert.equal(
      (await fetch(base + `/api/companies/${company}/zero-review`, { method: 'POST' })).status,
      401,
    );
    const denied = await post(reader.id, `/api/companies/${company}/zero-review`, {
      expectedFinancialVersion: version,
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'PERMISSION_DENIED');
    assert.equal(customerSnapshot(db, company, admin.organizationId, 'company').zeroReview?.pending, true);
    const cross = await post(writer.id, `/api/libyan-deposits/${libyan}/zero-review`, {
      expectedFinancialVersion: libyanVersion,
    });
    assert.equal(cross.status, 403);
    assert.equal((await cross.json()).error.details.permission, 'libyan_deposits.write');
    const wrongSection = await post(admin.id, `/api/customers/${company}/zero-review`, {
      expectedFinancialVersion: version,
    });
    assert.equal(wrongSection.status, 404);
    const listed = await fetch(base + '/api/companies?filter=pending-review', {
      headers: { Cookie: `abdo_session=${sessionFor(admin.id).token}` },
    });
    const listedBody = await listed.json();
    assert.equal(listed.status, 200);
    assert.deepEqual(
      listedBody.data.items.map((item: { id: string }) => item.id),
      [company],
    );
    assert.equal(listedBody.data.items[0].zeroReview.financialVersion, version);
    assert.equal(customerSnapshot(db, company, admin.organizationId, 'company').zeroReview?.pending, true);
    const stale = await post(writer.id, `/api/companies/${company}/zero-review`, {
      expectedFinancialVersion: version + 9,
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'ZERO_REVIEW_CHANGED');
    assert.equal(customerSnapshot(db, company, admin.organizationId, 'company').zeroReview?.pending, true);
    const confirmed = await post(writer.id, `/api/companies/${company}/zero-review`, {
      expectedFinancialVersion: version,
    });
    assert.equal(confirmed.status, 200);
    const confirmedBody = await confirmed.json();
    assert.equal(confirmedBody.ok, true);
    assert.equal(confirmedBody.data.zeroReview.pending, false);
    assert.equal(confirmedBody.data.zeroReview.financialVersion, version);
    assert.equal(confirmedBody.data.zeroReview.reviewedByName, writer.displayName);
    const replay = await post(admin.id, `/api/companies/${company}/zero-review`, {
      expectedFinancialVersion: version,
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.replayed, true);
    assert.equal(customerSnapshot(db, company, admin.organizationId, 'company').balanceUnits, 0);
    assert.equal(customerSnapshot(db, libyan, admin.organizationId, 'depositLyd').zeroReview?.pending, true);
    assert.equal(summaryOf(db, admin.organizationId, 'customer').pendingReviewCount, 0);
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const customerOnlyReviewSql = `
  DROP TRIGGER IF EXISTS customer_zero_review_insert;
  DROP TRIGGER IF EXISTS customer_zero_review_financial_change;
  DROP INDEX IF EXISTS idx_customers_review_feed;
  DROP INDEX IF EXISTS idx_customers_pending_review;
  CREATE TRIGGER customer_zero_review_insert AFTER INSERT ON customers
  WHEN NEW.section_key='customer_debts' AND NEW.system_link_key IS NULL AND NEW.current_balance_units=0
  BEGIN
    UPDATE customers SET zero_review_pending=1 WHERE id=NEW.id;
  END;
  CREATE TRIGGER customer_zero_review_financial_change
  AFTER UPDATE OF current_balance_units, financial_updated_at ON customers
  WHEN NEW.section_key='customer_debts' AND NEW.system_link_key IS NULL
  BEGIN
    UPDATE customers SET
      zero_review_pending=CASE WHEN NEW.current_balance_units=0 THEN 1 ELSE 0 END,
      zero_review_financial_version=OLD.zero_review_financial_version+1,
      zero_reviewed_at=NULL,zero_reviewed_by=NULL,zero_reviewed_by_name=NULL
    WHERE id=NEW.id;
  END;
  CREATE INDEX idx_customers_review_feed ON customers(
    organization_id,section_key,
    (CASE WHEN current_balance_units=0 AND (section_key<>'customer_debts' OR zero_review_pending=0) THEN 1 ELSE 0 END),
    financial_updated_at DESC,id DESC
  ) WHERE deleted_at IS NULL;
  CREATE INDEX idx_customers_pending_review ON customers(organization_id,financial_updated_at DESC,id DESC)
    WHERE section_key='customer_debts' AND current_balance_units=0 AND zero_review_pending=1 AND deleted_at IS NULL;
`;

test('schema 57 runs once from schema 56 and a trigger-only rollback keeps balances', () => {
  const directory = mkdtempSync(join(tmpdir(), 'section-zero-rollback-'));
  const path = join(directory, 'rollback.sqlite');
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations.filter((item) => item.version <= 56)) {
      legacy.exec('BEGIN IMMEDIATE');
      migration.before?.(legacy);
      legacy.exec(migration.sql);
      migration.after?.(legacy);
      legacy.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(migration.version, migration.name, new Date().toISOString());
      legacy.exec('COMMIT');
    }
    const admin = fixtureAdmin(legacy);
    createCustomer(legacy, admin, { requestId: randomUUID(), name: 'شركة محفوظة', openingBalance: 0 }, 'test', 'company');
    createCustomer(legacy, admin, { requestId: randomUUID(), name: 'دين محفوظ', openingBalance: 55 }, 'test', 'company');
    const before = legacy.prepare('SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name').all();
    const ledger = legacy.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    legacy.close();
    const upgraded = openDatabase(path);
    const accounts = () => upgraded.prepare('SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name').all();
    const ledgerNow = () => upgraded.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    try {
      assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=57').get()?.n, 1);
      assert.deepEqual(accounts(), before);
      assert.deepEqual(ledgerNow(), ledger);
      upgraded.close();
      const reopened = openDatabase(path);
      try {
        assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=57').get()?.n, 1);
        assert.match(String(reopened.prepare("SELECT sql FROM sqlite_master WHERE name='customer_zero_review_insert'").get()?.sql), /company_debts/);
        assert.deepEqual(reopened.prepare('SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name').all(), before);
        assert.deepEqual(reopened.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), ledger);
        reopened.exec(customerOnlyReviewSql);
        assert.equal(reopened.prepare("SELECT current_balance_units FROM customers WHERE name='دين محفوظ'").get()?.current_balance_units, 55);
        reopened.close();
        const afterRollback = openDatabase(path);
        try {
          assert.equal(afterRollback.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, Number(SCHEMA_VERSION));
          assert.equal(afterRollback.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=57').get()?.n, 1);
          assert.doesNotMatch(String(afterRollback.prepare("SELECT sql FROM sqlite_master WHERE name='customer_zero_review_insert'").get()?.sql), /company_debts/);
          assert.deepEqual(afterRollback.prepare('SELECT id,name,version,current_balance_units,financial_updated_at,zero_review_pending,zero_review_financial_version,zero_reviewed_at FROM customers ORDER BY name').all(), before);
          assert.deepEqual(afterRollback.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), ledger);
          const companyId = String(afterRollback.prepare("SELECT id FROM customers WHERE name='شركة محفوظة'").get()?.id);
          const versionBefore = afterRollback.prepare('SELECT zero_review_financial_version AS v FROM customers WHERE id=?').get(companyId)?.v;
          afterRollback.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run('2026-05-01T00:00:00.000Z', companyId);
          assert.equal(afterRollback.prepare('SELECT zero_review_pending AS p, zero_review_financial_version AS v, current_balance_units AS b FROM customers WHERE id=?').get(companyId)?.p, 0);
          assert.equal(afterRollback.prepare('SELECT zero_review_financial_version AS v FROM customers WHERE id=?').get(companyId)?.v, versionBefore);
          assert.equal(afterRollback.prepare('SELECT current_balance_units AS b FROM customers WHERE id=?').get(companyId)?.b, 0);
          createCustomer(afterRollback, admin, { requestId: randomUUID(), name: 'شركة بعد الرجوع', openingBalance: 0 }, 'test', 'company');
          createCustomer(afterRollback, admin, { requestId: randomUUID(), name: 'عميل بعد الرجوع', openingBalance: 0 }, 'test');
          assert.equal(afterRollback.prepare("SELECT zero_review_pending FROM customers WHERE name='شركة بعد الرجوع'").get()?.zero_review_pending, 0);
          assert.equal(afterRollback.prepare("SELECT zero_review_pending FROM customers WHERE name='عميل بعد الرجوع'").get()?.zero_review_pending, 1);
          assert.equal(afterRollback.prepare("SELECT current_balance_units FROM customers WHERE name='دين محفوظ'").get()?.current_balance_units, 55);
        } finally { afterRollback.close(); }
      } finally { if (reopened.isOpen) reopened.close(); }
    } finally { if (upgraded.isOpen) upgraded.close(); }
  } finally {
    if (legacy.isOpen) legacy.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a waiting review cannot approve a card whose financial update commits on another connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'section-zero-race-'));
  const path = join(directory, 'race.sqlite');
  const db = openDatabase(path);
  let holder: Worker | undefined;
  try {
    const admin = fixtureAdmin(db);
    const writer = employee(db, 'race-writer', ['companies.write']);
    const id = (createCustomer(db, admin, { requestId: randomUUID(), name: 'سباق شركة', openingBalance: 0 }, 'test', 'company').body.customer as { id: string }).id;
    const before = customerSnapshot(db, id, admin.organizationId, 'company');
    const moneyBefore = moneyState(db);
    holder = new Worker(new URL('./section-zero-review-lock.ts', import.meta.url), { workerData: { path, id } });
    const inbox: Array<{ ready?: boolean; committed?: boolean }> = [];
    let notify = () => {};
    holder.on('message', (message: { ready?: boolean; committed?: boolean }) => {
      inbox.push(message);
      notify();
    });
    const nextMessage = () => inbox.length
      ? Promise.resolve(inbox.shift()!)
      : new Promise<{ ready?: boolean; committed?: boolean }>((resolve) => { notify = () => resolve(inbox.shift()!); });
    const crashed = new Promise<never>((_, reject) => holder?.once('error', reject));
    const ready = await Promise.race([nextMessage(), crashed]);
    assert.equal(ready.ready, true);
    const started = performance.now();
    let caught: { status?: number; code?: string } | undefined;
    try {
      reviewCustomerZero(db, writer, id, { expectedFinancialVersion: before.zeroReview!.financialVersion }, 'race', 'company');
    } catch (error) {
      caught = error as { status?: number; code?: string };
    }
    const waitedMs = performance.now() - started;
    assert.ok(waitedMs >= 400, `review waited ${waitedMs}ms for the other connection`);
    assert.equal(caught?.status, 409);
    assert.equal(caught?.code, 'ZERO_REVIEW_CHANGED');
    const committed = await Promise.race([nextMessage(), crashed]);
    assert.equal(committed.committed, true);
    const after = customerSnapshot(db, id, admin.organizationId, 'company');
    assert.equal(after.balanceUnits, 0);
    assert.equal(after.version, before.version);
    assert.equal(after.zeroReview?.pending, true);
    assert.equal(after.zeroReview?.reviewedAt, null);
    assert.equal(after.zeroReview?.financialVersion, before.zeroReview!.financialVersion + 1);
    assert.deepEqual(db.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), moneyBefore.ledger);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='company.zero_review'").get()?.n, 0);
    assert.equal(summaryOf(db, admin.organizationId, 'company').totalDebt, 0);
    assert.equal(summaryOf(db, admin.organizationId, 'company').netBalance, 0);
    assert.equal(summaryOf(db, admin.organizationId, 'company').activeCards, 0);
    const other = openDatabase(path);
    try {
      const reviewed = reviewCustomerZero(other, admin, id, { expectedFinancialVersion: after.zeroReview!.financialVersion }, 'race-current', 'company');
      assert.equal(reviewed.status, 200);
      const replay = reviewCustomerZero(other, admin, id, { expectedFinancialVersion: after.zeroReview!.financialVersion }, 'race-replay', 'company');
      assert.equal(replay.body.replayed, true);
      addCustomerTransaction(db, admin, id, {
        requestId: randomUUID(), expectedVersion: customerSnapshot(db, id, admin.organizationId, 'company').version,
        type: 'debt', inputValue: 6, calculationMode: 'direct',
      }, 'race-after', 'company');
      const invalidated = customerSnapshot(other, id, admin.organizationId, 'company');
      assert.equal(invalidated.balanceUnits, 6);
      assert.equal(invalidated.zeroReview?.pending, false);
      assert.equal(invalidated.zeroReview?.reviewedAt, null);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='company.zero_review'").get()?.n, 1);
    } finally { other.close(); }
  } finally {
    await holder?.terminate();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
