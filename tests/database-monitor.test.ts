import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/server/db/database.ts';
import { databaseMonitor } from '../src/server/domain/databaseMonitor.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'db-monitor-'));
  const path = join(root, 'active.sqlite');
  const db = openDatabase(path);
  const config = loadConfig({
    databasePath: path,
    backupDirectory: join(root, 'backups'),
    internetRequired: false,
    pushPublicKey: '',
  });
  return {
    root,
    db,
    config,
    close: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test('database monitor reads actual files and distinguishes recorded, absent and invalid backup reports without modifying the database', async () => {
  const f = fixture();
  try {
    const before = f.db.prepare('SELECT total_changes() n').get()!.n;
    assert.equal((await databaseMonitor(f.db, f.config)).backups.folderState, 'missing');
    mkdirSync(f.config.backupDirectory!);
    const folder = f.config.backupDirectory!;
    for (const name of ['valid.sqlite', 'old.sqlite', 'broken.sqlite'])
      writeFileSync(join(folder, name), 'backup fixture');
    const report = {
      manifestVersion: 1,
      file: 'valid.sqlite',
      fileSizeBytes: 14,
      integrity: 'ok',
      foreignKeyProblems: 0,
      sha256: 'a'.repeat(64),
      schemaVersion: 47,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(folder, 'valid.sqlite.json'), JSON.stringify(report));
    writeFileSync(join(folder, 'broken.sqlite.json'), '{');
    writeFileSync(join(folder, 'secret.env'), 'not a backup');
    const snapshot = await databaseMonitor(f.db, f.config);
    assert.equal(snapshot.backups.count, 3);
    assert.equal(snapshot.backups.totalBytes, 42);
    assert.equal(snapshot.backups.items.find((x) => x.name === 'valid.sqlite')!.report, 'recorded');
    assert.equal(snapshot.backups.items.find((x) => x.name === 'old.sqlite')!.report, 'missing');
    assert.equal(snapshot.backups.items.find((x) => x.name === 'broken.sqlite')!.report, 'invalid');
    assert.equal(snapshot.database.path, f.config.databasePath);
    assert.equal(snapshot.schedule, null);
    assert.ok(snapshot.database.allocatedBytes > 0);
    assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n, before);
    writeFileSync(join(folder, 'valid.sqlite'), 'changed');
    assert.equal(
      (await databaseMonitor(f.db, f.config)).backups.items.find((x) => x.name === 'valid.sqlite')!.report,
      'invalid',
    );
  } finally {
    f.close();
  }
});
test('database monitor API denies anonymous, employee and non-owner administration access', async () => {
  const f = fixture();
  const server = createApp(f.db, f.config);
  try {
    await listen(server, '127.0.0.1', 0);
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const path = base + '/api/operations/database-monitor';
    assert.equal((await fetch(path)).status, 401);
    await fetch(base + '/api/setup/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'monitor-owner',
        displayName: 'مالك الاختبار',
        password: 'Monitor-Owner-123!',
      }),
    });
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Api-Version': '1' },
      body: JSON.stringify({ username: 'monitor-owner', password: 'Monitor-Owner-123!' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await fetch(path, { headers })).status, 200);
    f.db.prepare('UPDATE users SET is_owner=0').run();
    assert.equal((await fetch(path, { headers })).status, 403);
    f.db.prepare("UPDATE users SET role='employee'").run();
    assert.equal((await fetch(path, { headers })).status, 403);
  } finally {
    server.closeRealtimeConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.close();
  }
});
