import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer, listCustomers } from '../src/server/domain/customers.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { reserveLoginCheck } from '../src/server/security/loginProtection.ts';
import { loadConfig } from '../src/server/config.ts';
import { InternetGate } from '../src/server/internetGate.ts';

test('today feed respects local midnight, exclusive next midnight and organization timezone', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T00:30:00+02:00') });
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    const dates = ['2026-10-13T21:59:59.999Z', '2026-10-13T22:00:00.000Z', '2026-10-14T21:59:59.999Z', '2026-10-14T22:00:00.000Z'];
    const ids = dates.map((date, i) => {
      const id = (createCustomer(db, actor, { requestId: `local-day-${i}`, name: `عميل اختبار ${i}`, openingBalance: 10 }, 'test').body.customer as { id: string }).id;
      db.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run(date, id);
      return id;
    });
    const feed = () => listCustomers(db, new URL('http://test/api/customers?filter=today'), actor.organizationId).items.map(x => x.id);
    assert.deepEqual(new Set(feed()), new Set([ids[1], ids[2]]));
    // Cairo is UTC+3 on this date: at the same instant its day begins one hour earlier.
    db.prepare('UPDATE organization_settings SET timezone=? WHERE organization_id=?').run('Africa/Cairo', actor.organizationId);
    assert.deepEqual(new Set(feed()), new Set([ids[0], ids[1]]));
    assert.equal(db.prepare('SELECT SUM(current_balance_units) total FROM customers').get()!.total, 40);
  } finally { db.close(); }
});

test('password verification has bounded global, address and account concurrency and releases safely', () => {
  const db = openDatabase(':memory:');
  try {
    const releases = Array.from({ length: 4 }, (_, i) => reserveLoginCheck(db, 'user-' + i, 'office'));
    assert.ok(releases.every(x => typeof x === 'function'));
    assert.equal(reserveLoginCheck(db, 'user-0', 'elsewhere'), null);
    assert.equal(reserveLoginCheck(db, 'extra', 'office'), null);
    const others = Array.from({ length: 4 }, (_, i) => reserveLoginCheck(db, 'other-' + i, 'remote-' + i));
    assert.ok(others.every(x => typeof x === 'function'));
    assert.equal(reserveLoginCheck(db, 'extra', 'new-address'), null);
    releases[0]!(); releases[0]!();
    const retry = reserveLoginCheck(db, 'user-0', 'office');
    assert.equal(typeof retry, 'function');
    assert.equal(reserveLoginCheck(db, 'extra', 'new-address'), null);
    for (const release of [...releases, ...others, retry]) release!();
    const again = reserveLoginCheck(db, 'user-0', 'office');
    assert.equal(typeof again, 'function'); again!();
  } finally { db.close(); }
});

test('local operation does not probe the internet unless explicitly required', async (t) => {
  const previous = process.env.ABDO_INTERNET_REQUIRED;
  t.after(() => { if (previous === undefined) delete process.env.ABDO_INTERNET_REQUIRED; else process.env.ABDO_INTERNET_REQUIRED = previous; });
  delete process.env.ABDO_INTERNET_REQUIRED;
  assert.equal(loadConfig().internetRequired, false);
  let calls = 0;
  const gate = new InternetGate(loadConfig(), async () => { calls++; throw new Error('offline'); });
  assert.equal(await gate.isAvailable(), true);
  assert.equal(calls, 0);
  process.env.ABDO_INTERNET_REQUIRED = 'true';
  assert.equal(loadConfig().internetRequired, true);
  assert.equal(loadConfig({ internetRequired: false }).internetRequired, false);
});
