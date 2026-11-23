import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';

test('public HEAD checks match GET metadata without a body and retain API authentication', async () => {
  const db = openDatabase(':memory:'); fixtureAdmin(db);
  const server = createApp(db, loadConfig({ databasePath: ':memory:', internetRequired: false, publicOrigin: '', pushPrivateKey: '', pushPublicKey: '' }));
  try {
    await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const path of ['/erp', '/api/health']) {
      const get = await fetch(base + path), head = await fetch(base + path, { method: 'HEAD' });
      assert.equal(get.status, 200); assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      for (const name of ['content-type', 'cache-control', 'x-frame-options', 'content-security-policy'])
        assert.equal(head.headers.get(name), get.headers.get(name), name);
      if (path === '/erp') {
        assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
        const html = await get.text(), asset = html.match(/src="([^"]+\.js)"/)?.[1];
        assert.ok(asset);
        const response = await fetch(base + asset, { method: 'HEAD' });
        assert.equal(response.status, 200); assert.equal(await response.text(), '');
        assert.match(response.headers.get('cache-control')!, /immutable/);
      } else await get.body?.cancel();
    }
    assert.equal((await fetch(base + '/api/me', { method: 'HEAD' })).status, 401);
  } finally {
    server.closeRealtimeConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});
