import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instrumentDatabase,
  operationKind,
  withoutDatabaseMeasurement,
  type Observation,
} from '../src/server/db/databaseInstrumentation.ts';
import { startDatabaseActivity, validActivityDay } from '../src/server/db/databaseActivity.ts';
test('measurement preserves query binding, transactions, iteration and exact errors while excluding monitor requests', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY,value TEXT UNIQUE)');
  const observations: Observation[] = [];
  const stop = instrumentDatabase(db, (value) => observations.push(value));
  try {
    const insert = db.prepare('INSERT INTO sample(value) VALUES(?)');
    assert.equal(insert.run('private value').changes, 1);
    assert.equal(insert.run('second').lastInsertRowid, 2);
    assert.equal(db.prepare('SELECT value FROM sample WHERE id=?').get(1)!.value, 'private value');
    assert.equal([...db.prepare('SELECT * FROM sample').iterate()].length, 2);
    for (const row of db.prepare('SELECT * FROM sample').iterate()) {
      assert.equal(row.id, 1);
      break;
    }
    assert.throws(() => insert.run('private value'), /UNIQUE/);
    assert.equal(observations.filter((x) => x.failed).length, 1);
    const before = observations.length;
    await withoutDatabaseMeasurement(async () => {
      await Promise.resolve();
      db.prepare('SELECT * FROM sample').all();
    });
    assert.equal(observations.length, before);
    db.exec('BEGIN');
    insert.run('rolled back');
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sample').get()!.n, 2);
    assert.ok(!JSON.stringify(observations).includes('private value'));
    assert.equal(operationKind("/* update */ WITH x AS (SELECT 'delete') SELECT * FROM x"), 'reads');
    assert.equal(operationKind('WITH x AS (SELECT 1) UPDATE sample SET value=?'), 'writes');
    const beforeStop = observations.length;
    stop();
    insert.run('after stop');
    assert.equal(observations.length, beforeStop);
  } finally {
    stop();
    db.close();
  }
});
test('observer failure cannot fail a successful financial write', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(id INTEGER)');
  const stop = instrumentDatabase(db, () => {
    throw Error('monitor failure');
  });
  try {
    db.prepare('INSERT INTO sample VALUES(?)').run(7);
    assert.equal(db.prepare('SELECT id FROM sample').get()!.id, 7);
  } finally {
    stop();
    db.close();
  }
});
test('minute storage survives restart without duplication, preserves gaps and Tripoli day boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-'));
  const path = join(root, 'app.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE sample(id INTEGER)');
  let now = Date.parse('2026-10-12T21:59:58Z');
  let service = startDatabaseActivity(db, { timers: false, clock: () => now });
  try {
    db.prepare('INSERT INTO sample VALUES(1)').run();
    now += 1000;
    service.live();
    service.flush();
    service.flush();
    assert.equal(service.daily('2026-10-12').hours[23].writes, 1);
    now += 2000;
    db.prepare('SELECT * FROM sample').all();
    assert.equal(service.daily('2026-10-13').hours[0].reads, 1);
    assert.equal(service.daily('2026-10-13').hours[1].observedMs, 0);
    const coverage = service.live().points.reduce((sum, p) => sum + p.observedMs, 0);
    now += 600000;
    assert.equal(
      service.live().points.reduce((sum, p) => sum + p.observedMs, 0),
      0,
    );
    assert.ok(coverage > 0);
    service.stop();
    service = startDatabaseActivity(db, { timers: false, clock: () => now });
    assert.equal(service.daily('2026-10-12').hours[23].writes, 1);
    assert.equal(service.daily('2026-10-13').hours[0].reads, 1);
    assert.ok(validActivityDay('2026-10-13', now));
    assert.equal(validActivityDay('2026-02-30', now), false);
    assert.equal(validActivityDay('2026-10-14', now), false);
    now += 31 * 86400000;
    service.flush();
    assert.equal(service.daily('2026-10-12').hours[23].operations, 0);
  } finally {
    service.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('unavailable metrics storage does not block writes or fabricate daily history', () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-failure-'));
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sample(id INTEGER)');
  const service = startDatabaseActivity(db, {
    timers: false,
    historyPath: join(root, 'missing', 'activity.sqlite'),
  });
  try {
    db.prepare('INSERT INTO sample VALUES(1)').run();
    assert.equal(service.live().historyAvailable, false);
    assert.equal(service.daily('2026-10-13').available, false);
    service.flush();
    assert.equal(db.prepare('SELECT count(*) n FROM sample').get()!.n, 1);
  } finally {
    service.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('closing the business database releases the metrics file even before server shutdown', () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-close-'));
  const db = new DatabaseSync(join(root, 'app.sqlite'));
  const service = startDatabaseActivity(db, { timers: false });
  db.close();
  service.stop();
  rmSync(root, { recursive: true, force: true });
});

test('slow statements and real SQLite busy errors appear in counters without bypassing locks', () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-busy-'));
  const path = join(root, 'app.sqlite');
  const db = new DatabaseSync(path, { timeout: 1 });
  db.exec('CREATE TABLE sample(id INTEGER)');
  const other = new DatabaseSync(path);
  const service = startDatabaseActivity(db, { timers: false });
  try {
    db.function('slow_fixture', () => {
      const end = performance.now() + 60;
      while (performance.now() < end) {
        /* controlled test workload */
      }
      return 1;
    });
    db.prepare('SELECT slow_fixture()').get();
    other.exec('BEGIN IMMEDIATE');
    assert.throws(() => db.prepare('INSERT INTO sample VALUES(1)').run(), /locked/);
    other.exec('ROLLBACK');
    const counters = service.live().points;
    assert.equal(
      counters.reduce((sum, p) => sum + p.slow, 0),
      1,
    );
    assert.equal(
      counters.reduce((sum, p) => sum + p.busy, 0),
      1,
    );
    assert.equal(db.prepare('SELECT count(*) n FROM sample').get()!.n, 0);
  } finally {
    service.stop();
    other.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
