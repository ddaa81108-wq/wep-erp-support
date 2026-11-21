import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';

test('timing distinguishes internet gate delay, including concurrent requests and error responses', async () => {
  const db = openDatabase(':memory:');
  const server = createApp(db, loadConfig({ databasePath: ':memory:', internetRequired: false, publicOrigin: '' }), {
    internetCheck: async () => { await new Promise(resolve => setTimeout(resolve, 25)); return true; },
  });
  try {
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const responses = await Promise.all(['/api/health', '/api/health', '/api/not-a-route'].map(path => fetch(origin + path)));
    assert.deepEqual(responses.map(response => response.status), [200, 200, 401]);
    for (const response of responses) {
      const header = response.headers.get('server-timing') ?? '';
      const metrics = Object.fromEntries([...header.matchAll(/(total|gate|app);dur=([\d.]+)/g)].map(match => [match[1], Number(match[2])]));
      assert.deepEqual(Object.keys(metrics).sort(), ['app', 'gate', 'total']);
      assert.ok(metrics.gate >= 10, 'The delayed gate is separately measurable');
      assert.ok(Math.abs(metrics.total - metrics.gate - metrics.app) <= 0.02);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      await response.text();
    }
  } finally {
    server.closeRealtimeConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
