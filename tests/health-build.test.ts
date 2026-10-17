import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';
import { BUILD_INFO } from '../src/shared/buildInfo.ts';

test('health exposes build provenance without configuration secrets', async () => {
  const db = openDatabase(':memory:');
  const config = loadConfig({
    databasePath: ':memory:',
    host: '127.0.0.1',
    port: 0,
    internetRequired: false,
    pushPrivateKey: 'private-test-secret',
  });
  const server = createApp(db, config);
  try {
    await listen(server, '127.0.0.1', 0);
    const response = await fetch(
      'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/health',
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.status, 'ready');
    assert.deepEqual(body.data.build, BUILD_INFO);
    assert.equal(JSON.stringify(body).includes('private-test-secret'), false);
    assert.equal(JSON.stringify(body).includes('databasePath'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
