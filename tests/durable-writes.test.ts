import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { durableWrite } from '../src/server/db/durableWrites.ts';
import { beforeTransactionCommit, inImmediateTransaction, openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { readFiveAmClosing } from '../src/server/domain/reports/fiveAmClosing.ts';

test('overload rejects excess work before execution while accepted writes still commit', async () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  try {
    const accepted = Array.from({ length: 1024 }, (_, id) =>
      durableWrite(db, () => db.prepare('INSERT INTO batch_probe VALUES(?)').run(id)),
    );
    let executed = false;
    await assert.rejects(
      durableWrite(db, () => {
        executed = true;
      }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 503,
    );
    await Promise.all(accepted);
    assert.equal(executed, false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 1024);
  } finally {
    db.close();
  }
});

test('33 queued writes use three bounded commits and only settle outside the committed transaction', async () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  let commits = 0;
  const unhook = beforeTransactionCommit(db, () => {
    assert.equal(db.isTransaction, true);
    commits++;
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 33 }, (_, i) =>
        durableWrite(db, () => {
          db.prepare('INSERT INTO batch_probe VALUES(?)').run(i);
          return i;
        }).then((value) => {
          assert.equal(db.isTransaction, false);
          return value;
        }),
      ),
    );
    assert.equal(commits, 3);
    assert.equal(results.length, 33);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 33);
  } finally {
    unhook();
    db.close();
  }
});

test('a failed operation rolls back its savepoint without losing a valid neighbor', async () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  try {
    const results = await Promise.allSettled([
      durableWrite(db, () => {
        db.exec('INSERT INTO batch_probe VALUES(1)');
        throw new Error('validation failure');
      }),
      durableWrite(db, () => {
        db.exec('INSERT INTO batch_probe VALUES(2)');
        return 2;
      }),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.deepEqual(results[1], { status: 'fulfilled', value: 2 });
    assert.deepEqual(
      db
        .prepare('SELECT id FROM batch_probe')
        .all()
        .map((row) => row.id),
      [2],
    );
  } finally {
    db.close();
  }
});

test('all-invalid batches skip commit observers, reject asynchronous work and never acknowledge an external transaction', async () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  let observers = 0;
  const unhook = beforeTransactionCommit(db, () => {
    observers++;
  });
  try {
    await assert.rejects(
      durableWrite(db, () => {
        db.exec('INSERT INTO batch_probe VALUES(1)');
        return Promise.resolve(1);
      }),
      /synchronous/,
    );
    await assert.rejects(
      durableWrite(db, async () => {
        db.exec('INSERT INTO batch_probe VALUES(2)');
      }),
      /synchronous/,
    );
    assert.equal(observers, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 0);
    db.exec('BEGIN IMMEDIATE');
    await assert.rejects(
      durableWrite(db, () => db.exec('INSERT INTO batch_probe VALUES(3)')),
      /external transaction/,
    );
    assert.equal(db.isTransaction, true);
    db.exec('ROLLBACK');
  } finally {
    unhook();
    db.close();
  }
});

test('a commit-stage failure rolls back every successful operation and rejects every acknowledgement', async () => {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  const unhook = beforeTransactionCommit(db, () => {
    throw new Error('commit observer failure');
  });
  try {
    const result = await Promise.allSettled(
      [1, 2].map((id) => durableWrite(db, () => db.prepare('INSERT INTO batch_probe VALUES(?)').run(id))),
    );
    assert.ok(result.every((item) => item.status === 'rejected'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 0);
  } finally {
    unhook();
    db.close();
  }
});

test('concurrent idempotent replays and stale versions retain one ledger effect', async () => {
  const db = openDatabase(':memory:'),
    actor = fixtureAdmin(db);
  const id = String(
    (
      createCustomer(
        db,
        actor,
        { name: 'عميل دفعة الاختبار', openingBalance: 100, requestId: 'batch-customer' },
        'test',
      ).body.customer as { id: string }
    ).id,
  );
  const body = {
    requestId: 'batch-replay-request',
    expectedVersion: 1,
    type: 'debt',
    inputValue: 10,
    calculationMode: 'direct',
  };
  try {
    const repeated = await Promise.all(
      Array.from({ length: 20 }, () =>
        durableWrite(db, () => addCustomerTransaction(db, actor, id, body, 'test')),
      ),
    );
    assert.equal(new Set(repeated.map((result) => (result.body.transaction as { id: string }).id)).size, 1);
    const competing = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) =>
        durableWrite(db, () =>
          addCustomerTransaction(
            db,
            actor,
            id,
            { ...body, requestId: `batch-conflict-${i}`, expectedVersion: 2 },
            'test',
          ),
        ),
      ),
    );
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
    for (const result of competing) if (result.status === 'rejected') assert.equal(result.reason.status, 409);
    assert.equal(
      db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(id)!.balance,
      120,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions WHERE customer_id=?').get(id)!.n, 3);
  } finally {
    db.close();
  }
});

test('FULL WAL durability is preserved and a separate connection sees results only after commit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abdo-durable-batch-')),
    path = join(dir, 'test.sqlite');
  const db = openDatabase(path);
  db.exec('CREATE TABLE batch_probe (id INTEGER PRIMARY KEY)');
  const reader = new DatabaseSync(path, { readOnly: true });
  const unhook = beforeTransactionCommit(db, () => {
    assert.equal(reader.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 0);
  });
  try {
    assert.equal(db.prepare('PRAGMA synchronous').get()!.synchronous, 2);
    await Promise.all(
      [1, 2].map((id) =>
        durableWrite(db, () => db.prepare('INSERT INTO batch_probe VALUES(?)').run(id)).then(() => {
          assert.equal(reader.prepare('SELECT COUNT(*) n FROM batch_probe').get()!.n, 2);
        }),
      ),
    );
  } finally {
    unhook();
    reader.close();
    db.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith('abdo-durable-batch-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a grouped commit crossing 05:00 preserves the last committed closing rather than its in-flight writes', async (context) => {
  const before = Date.parse('2026-11-19T02:59:59.500Z'),
    due = Date.parse('2026-11-19T03:00:00Z');
  context.mock.timers.enable({ apis: ['Date'], now: before });
  const db = openDatabase(':memory:'),
    stop = startReportScheduler(db);
  let unhook = () => {};
  try {
    inImmediateTransaction(db, () => db.exec('UPDATE treasury_cash_accounts SET balance_units=100'));
    unhook = beforeTransactionCommit(db, () => context.mock.timers.setTime(due + 1));
    await Promise.all(
      [999, 1000].map((value) =>
        durableWrite(db, () => db.prepare('UPDATE treasury_cash_accounts SET balance_units=?').run(value)),
      ),
    );
    unhook();
    inImmediateTransaction(db, () => undefined);
    assert.equal(readFiveAmClosing(db, 'org-default', '2026-11-18').netUnits, 100);
    assert.equal(db.prepare('SELECT balance_units FROM treasury_cash_accounts').get()!.balance_units, 1000);
  } finally {
    unhook();
    stop();
    db.close();
  }
});
