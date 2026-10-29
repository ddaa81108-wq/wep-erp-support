import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import {
  createCustomer,
  addCustomerTransaction,
  updateCustomerDetails,
} from '../src/server/domain/customers.ts';
import { listCustomers } from '../src/server/domain/customerQueries.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { EventHub, latestEventSequence } from '../src/server/events.ts';
import {
  listPurchases,
  createPurchaseEntry,
  updatePurchaseEntry,
  deletePurchaseEntry,
} from '../src/server/domain/purchases.ts';

test('compact purchase rows retain exact running balances, common day versions, corrections and removals', () => {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  const read = (known?: string) => listPurchases(db, admin, 'al_bayan', null, 100, known);
  const input = {
    itemCode: 'custom',
    itemLabel: 'مطابقة مشتريات',
    egpValueUnits: 100,
    calculationMode: 'divide' as const,
    exchangeRate: '10',
    paidUnits: 1,
    vodafoneConsumedUnits: 0,
  };
  const restore = (previous: ReturnType<typeof read>, delta: ReturnType<typeof read>) => {
    const cached = new Map([...previous.entries, ...delta.entries].map((entry) => [entry.id, entry]));
    return delta.orderedEntryIds!.map((id) => {
      const entry = cached.get(id)!;
      return { ...entry, ...delta.entryDays![entry.dayId] };
    });
  };
  try {
    for (let index = 0; index < 30; index++)
      createPurchaseEntry(
        db,
        admin,
        'al_bayan',
        { ...input, requestId: `compact-purchase-${index}`, expectedDayVersion: read().day.version },
        'test',
      );
    let previous = read();
    let tags = previous.entries.map((entry) => entry.viewTag).join(',');
    const unchanged = read(tags);
    assert.equal(unchanged.entries.length, 0);
    assert.deepEqual(restore(previous, unchanged), previous.entries);
    createPurchaseEntry(
      db,
      admin,
      'al_bayan',
      { ...input, requestId: 'compact-purchase-append', expectedDayVersion: previous.day.version },
      'test',
    );
    const appended = read(tags),
      full = read();
    assert.equal(appended.entries.length, 1);
    assert.deepEqual(restore(previous, appended), full.entries);
    assert.deepEqual(appended.registerTotals, full.registerTotals);
    assert.deepEqual(appended.day, full.day);
    assert.ok(Buffer.byteLength(JSON.stringify(appended)) < Buffer.byteLength(JSON.stringify(full)) / 3);
    previous = full;
    tags = previous.entries.map((entry) => entry.viewTag).join(',');
    const edited = previous.entries[0];
    updatePurchaseEntry(
      db,
      admin,
      'al_bayan',
      edited.id,
      {
        ...input,
        egpValueUnits: 250,
        expectedVersion: edited.version,
        expectedDayVersion: previous.day.version,
        requestId: 'compact-purchase-edit',
      },
      'test',
    );
    const correction = read(tags);
    assert.deepEqual(restore(previous, correction), read().entries);
    assert.deepEqual(correction.registerTotals, read().registerTotals);
    previous = read();
    tags = previous.entries.map((entry) => entry.viewTag).join(',');
    const deleted = previous.entries.at(-1)!;
    deletePurchaseEntry(
      db,
      admin,
      'al_bayan',
      deleted.id,
      {
        requestId: 'compact-purchase-delete',
        expectedVersion: deleted.version,
        expectedDayVersion: previous.day.version,
      },
      'test',
    );
    const removed = read(tags);
    assert.ok(!removed.orderedEntryIds!.includes(deleted.id));
    assert.deepEqual(restore(previous, removed), read().entries);
    assert.deepEqual(removed.registerTotals, read().registerTotals);
  } finally {
    db.close();
  }
});

test('compact account refresh preserves server ordering, whole-section totals, edits and page membership', () => {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  try {
    for (let index = 0; index < 24; index++)
      createCustomer(
        db,
        admin,
        { name: `عميل اختبار ${index}`, openingBalance: 100 + index, requestId: `compact-seed-${index}` },
        'test',
      );
    const url = new URL('http://local/api/customers?limit=20');
    const first = listCustomers(db, url, admin.organizationId);
    url.searchParams.set('known', first.items.map((item) => item.viewTag).join(','));
    const same = listCustomers(db, url, admin.organizationId);
    assert.equal(same.items.length, 0);
    assert.deepEqual(
      same.orderedIds,
      first.items.map((item) => item.id),
    );
    assert.deepEqual(same.summary, first.summary);
    assert.equal(same.nextCursor, first.nextCursor);
    const target = first.items[0];
    addCustomerTransaction(
      db,
      admin,
      target.id,
      {
        requestId: 'compact-debt-change',
        expectedVersion: target.version,
        type: 'debt',
        inputValue: 17,
        calculationMode: 'direct',
      },
      'test',
    );
    const changed = listCustomers(db, url, admin.organizationId);
    assert.equal(changed.items.length, 1);
    assert.equal(changed.items[0].id, target.id);
    assert.equal(changed.items[0].balanceUnits, target.balanceUnits + 17);
    assert.equal(changed.summary.netBalance, first.summary.netBalance + 17);
    // A previously off-page row must be sent in full when it enters the window.
    const all = listCustomers(db, new URL('http://local/api/customers?limit=200'), admin.organizationId);
    const outside = all.items.find((item) => !first.items.some((known) => known.id === item.id))!;
    addCustomerTransaction(
      db,
      admin,
      outside.id,
      {
        requestId: 'compact-offpage-change',
        expectedVersion: outside.version,
        type: 'debt',
        inputValue: 3,
        calculationMode: 'direct',
      },
      'test',
    );
    const reordered = listCustomers(db, url, admin.organizationId);
    assert.ok(reordered.items.some((item) => item.id === outside.id));
    const full = listCustomers(db, new URL('http://local/api/customers?limit=20'), admin.organizationId);
    assert.deepEqual(
      reordered.orderedIds,
      full.items.map((item) => item.id),
    );
    assert.deepEqual(reordered.summary, full.summary);
    const known = new Map([...first.items, ...reordered.items].map((item) => [item.id, item]));
    assert.deepEqual(
      reordered.orderedIds!.map((id) => known.get(id)),
      full.items,
    );
    updateCustomerDetails(
      db,
      admin,
      target.id,
      { name: 'اسم معدّل', phone: '12345', expectedVersion: changed.items[0].version },
      'test',
    );
    assert.ok(
      listCustomers(db, url, admin.organizationId).items.some(
        (item) => item.id === target.id && item.name === 'اسم معدّل',
      ),
    );
    const search = new URL(url);
    search.searchParams.set('q', 'اسم معدّل');
    const filtered = listCustomers(db, search, admin.organizationId);
    assert.equal(filtered.totalItems, 1);
    assert.deepEqual(
      filtered.summary,
      listCustomers(db, new URL('http://local/api/customers'), admin.organizationId).summary,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(same)) < Buffer.byteLength(JSON.stringify(first)) / 3);
    const bad = new URL(url);
    bad.searchParams.set('known', 'invalid');
    assert.throws(() => listCustomers(db, bad, admin.organizationId));
  } finally {
    db.close();
  }
});

test('notification conditional reads remain private, update after deletion, and unified search respects permissions', async () => {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as const)
    createCustomer(
      db,
      admin,
      { name: 'محمد البحث', openingBalance: 123, requestId: `unified-${kind}` },
      'test',
      kind,
    );
  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.create','customer','{}',?)",
  ).run(admin.organizationId, admin.id, admin.id, new Date().toISOString());
  const server = createApp(
    db,
    loadConfig({ databasePath: ':memory:', internetRequired: false, publicOrigin: '', secureCookie: false }),
  );
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const session = createSession(db, admin.id, '1', 1);
  const headers = { Cookie: `abdo_session=${session.token}` };
  try {
    const me = await (await fetch(base + '/api/me', { headers })).json();
    assert.equal(me.data.liveSequence, latestEventSequence(db, admin.organizationId));
    const response = await fetch(base + '/api/notifications', { headers });
    assert.equal(response.status, 200);
    const etag = response.headers.get('etag')!;
    assert.ok(etag);
    const body = await response.json();
    const cached = await fetch(base + '/api/notifications', {
      headers: { ...headers, 'If-None-Match': etag },
    });
    assert.equal(cached.status, 304);
    assert.equal((await cached.text()).length, 0);
    const weak=await fetch(base+'/api/notifications',{headers:{...headers,'If-None-Match':'"another-version", W/'+etag}});
    assert.equal(weak.status,304,'GET validators remain valid when a compression proxy weakens ETag');
    db.prepare('DELETE FROM notifications WHERE recipient_user_id=?').run(admin.id);
    const updated = await fetch(base + '/api/notifications', {
      headers: { ...headers, 'If-None-Match': etag },
    });
    assert.ok(body.data.items.length);
    assert.equal(updated.status, 200);
    assert.notEqual(updated.headers.get('etag'), etag);
    const search = await (
      await fetch(base + '/api/account-search?q=' + encodeURIComponent('محمد'), { headers })
    ).json();
    assert.deepEqual(
      search.data.items.map((item: { section: string }) => item.section),
      ['customers', 'companies', 'libyan-deposits', 'egyptian-deposits'],
    );
    db.prepare("UPDATE users SET role='employee' WHERE id=?").run(admin.id);
    db.prepare(
      "INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,'companies.read',1,?)",
    ).run(admin.id, new Date().toISOString());
    const limited = await (
      await fetch(base + '/api/account-search?q=' + encodeURIComponent('محمد'), { headers })
    ).json();
    assert.deepEqual(
      limited.data.items.map((item: { section: string }) => item.section),
      ['companies'],
    );
    assert.equal((await fetch(base + '/api/account-search?q=abc')).status, 401);
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('large event backlog and future cursor reconcile at the authoritative checkpoint without dumping history', () => {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  try {
    const session = createSession(db, admin.id, '1', 1);
    const viewer = {
      userId: admin.id,
      sessionTokenHash: db.prepare('SELECT token_hash FROM sessions').get()!.token_hash as string,
    };
    for (let index = 0; index < 610; index++)
      db.prepare(
        "INSERT INTO event_log(topic,organization_id,payload_json,created_at) VALUES('customer.changed',?,'{}',?)",
      ).run(admin.organizationId, new Date().toISOString());
    assert.ok(session.token);
    const hub = new EventHub(db);
    const latest = latestEventSequence(db, admin.organizationId);
    assert.deepEqual(hub.changesAfter(0, viewer), { fullResync: true, latest, events: [] });
    assert.deepEqual(hub.changesAfter(latest + 100, viewer), { fullResync: true, latest, events: [] });
    assert.equal(hub.changesAfter(latest - 2, viewer)!.events.length, 2);
    assert.deepEqual(hub.changesAfter(latest, viewer), { fullResync: false, latest, events: [] });
    hub.close();
  } finally {
    db.close();
  }
});
