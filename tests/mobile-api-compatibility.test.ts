import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { hashPassword } from '../src/server/security/password.ts';

test('mobile API v1 preserves cookie/CSRF authentication, integer balances, replay and logout', async () => {
  const { db, admin } = collectionFixture();
  const password = 'Synthetic API Contract 123!';
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(password), admin.id);
  const server = createApp(
    db,
    loadConfig({
      databasePath: ':memory:',
      publicOrigin: '',
      secureCookie: false,
      internetRequired: false,
      pushPublicKey: '',
      pushPrivateKey: '',
    }),
  );
  try {
    await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Api-Version': '1' },
      body: JSON.stringify({ username: admin.username, password }),
    });
    assert.equal(login.status, 200);
    const cookieHeader = login.headers.get('set-cookie')!;
    assert.match(cookieHeader, /^abdo_session=/);
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Strict/i);
    const cookie = cookieHeader.split(';')[0],
      loggedIn = await login.json();
    assert.equal(typeof loggedIn.data.csrfToken, 'string');
    const headers = {
      Cookie: cookie,
      'X-CSRF-Token': String(loggedIn.data.csrfToken),
      'X-Client-Api-Version': '1',
      'Content-Type': 'application/json',
    };
    const me = await (await fetch(base + '/api/me', { headers })).json();
    assert.equal(me.data.user.id, admin.id);
    assert.ok(Array.isArray(me.data.user.permissions));
    const post = (path: string, body: object, extra = {}) =>
      fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const denied = await post('/api/customers', { name: 'Must not save' }, { 'X-CSRF-Token': '' });
    assert.equal(denied.status, 403);
    const oldClient = await post('/api/customers', { name: 'Old client' }, { 'X-Client-Api-Version': '0' });
    assert.equal(oldClient.status, 409);
    assert.equal((await oldClient.json()).error.code, 'CLIENT_VERSION_MISMATCH');
    for (const section of ['customers', 'companies', 'libyan-deposits', 'egyptian-deposits']) {
      const created = await post(`/api/${section}`, {
        name: `Synthetic ${section}`,
        openingBalance: 100,
        requestId: `contract-create-${section}`,
      });
      assert.equal(created.status, 201, section);
      const account = (await created.json()).data.customer;
      assert.equal(account.balanceUnits, 100);
      assert.ok(Number.isSafeInteger(account.version));
      const path = `/api/${section}/${account.id}/transactions`;
      const partial = {
        requestId: `contract-pay-${section}`,
        expectedVersion: account.version,
        type: 'payment',
        paymentMode: 'partial',
        inputValue: 30,
        calculationMode: 'direct',
      };
      const paid = await post(path, partial);
      assert.equal(paid.status, 201);
      const saved = (await paid.json()).data;
      assert.equal(saved.balanceUnits, 70);
      assert.ok(Number.isSafeInteger(saved.customerVersion));
      const replay = await post(path, partial);
      assert.equal(replay.status, 201);
      assert.equal((await replay.json()).data.transaction.id, saved.transaction.id);
      const stale = await post(path, { ...partial, requestId: `contract-stale-${section}` });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).error.code, 'VERSION_CONFLICT');
      const final = await post(path, {
        ...partial,
        requestId: `contract-final-${section}`,
        expectedVersion: saved.customerVersion,
        inputValue: 70,
      });
      assert.equal(final.status, 201);
      assert.equal((await final.json()).data.balanceUnits, 0);
      const ledger = await (await fetch(`${base}/api/${section}/${account.id}/ledger`, { headers })).json();
      assert.equal(ledger.data.customer.balanceUnits, 0);
      assert.equal(ledger.data.items.filter((item: { type: string }) => item.type === 'payment').length, 2);
    }
    const logout = await post('/api/auth/logout', {});
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).data.loggedOut, true);
    assert.equal((await fetch(base + '/api/me', { headers })).status, 401);
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
