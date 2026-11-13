import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp, listen } from '../src/server/app.ts';
import { API_VERSION, loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { rollbackMobilePush } from '../src/server/db/migrationsMobilePush.ts';
import {
  createMobilePushDispatcher,
  fcmChannelId,
  type FcmAccount,
} from '../src/server/domain/mobilePush.ts';
import { SESSION_COOKIE, createSession } from '../src/server/security/sessions.ts';

const generated = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account: FcmAccount = {
  projectId: 'vib-test',
  clientEmail: 'push@vib-test.iam.gserviceaccount.com',
  privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

test('local file migration sends only through the mock and rolls back without touching money', async () => {
  delete process.env.ABDO_FCM_SERVICE_ACCOUNT_FILE;
  const root = mkdtempSync(join(tmpdir(), 'vib-fcm-'));
  const path = join(root, 'local.sqlite');
  const db = openDatabase(path);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('googleapis.com') || url.includes('fcm.googleapis.com')) {
      throw new Error('live network is not used');
    }
    return originalFetch(input, init);
  };
  try {
    assert.equal(db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get()?.v, 59);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run('e2e-user', 'e2e-user', 'مستخدم تجريبي', 'hash', 'admin', 'org-default', 'branch-main', now, now);
    db.prepare(
      `INSERT INTO customers(id,name,normalized_name,phone,organization_id,section_key,current_balance_units,created_at,updated_at)
       VALUES(?,?,?,?, 'org-default','customer_debts',1250,?,?)`,
    ).run('e2e-customer', 'عميل تجريبي', 'e2e-customer', '0910000000', now, now);
    const moneyBefore = snapshot(db);
    const notice = db
      .prepare(
        `INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at)
         VALUES(?,?,?,'customer.debt','customer',?,?)`,
      )
      .run(
        'org-default',
        'e2e-user',
        'e2e-user',
        JSON.stringify({ subjectName: 'عميل تجريبي', amountUnits: 1250 }),
        now,
      );
    const noticeId = Number(notice.lastInsertRowid);
    const stored = notificationRow(db, noticeId);
    assert.equal(stored.details_json.includes('1250'), true);
    assert.deepEqual(snapshot(db), moneyBefore);
    assert.equal(
      db
        .prepare('PRAGMA table_info(notifications)')
        .all()
        .some((column) => column.name === 'token'),
      false,
    );

    const session = createSession(db, 'e2e-user', API_VERSION, 1);
    const server = createApp(
      db,
      loadConfig({
        databasePath: path,
        publicOrigin: '',
        secureCookie: false,
        internetRequired: false,
        pushPublicKey: '',
        pushPrivateKey: '',
      }),
      { internetCheck: async () => true },
    );
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const origin = `http://127.0.0.1:${port}`;
    try {
      const registered = await fetch(`${origin}/api/mobile-push/devices`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE}=${session.token}`,
          origin,
          'content-type': 'application/json',
          'x-client-api-version': API_VERSION,
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({ token: 'c'.repeat(40), platform: 'android' }),
      });
      assert.equal(registered.status, 200);
      db.prepare(
        `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
         VALUES('e2e-employee','e2e-employee','موظف تجريبي','hash','employee','org-default','branch-main',?,?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at)
         VALUES(?,?,'e2e-employee','customer.payment','customer','{}',?)`,
      ).run('org-default', 'e2e-user', now);
      assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n), 1);
      assert.equal(
        calls.some((url) => url.includes('googleapis.com') || url.includes('fcm')),
        false,
      );
      assert.equal(snapshot(db).balance, 1250);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const sent: Array<{ token: string; channelId: string }> = [];
    const dispatcher = createMobilePushDispatcher(db, account, async (message) => {
      sent.push({ token: message.token, channelId: message.channelId });
    });
    await dispatcher.drain();
    dispatcher.stop();
    assert.deepEqual(sent, [{ token: 'c'.repeat(40), channelId: fcmChannelId }]);
    assert.equal(snapshot(db).balance, 1250);
    assert.deepEqual(notificationRow(db, noticeId), stored);

    rollbackMobilePush(db);
    assert.equal(db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get()?.v, 58);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'mobile_push%'").get()?.n,
      0,
    );
    assert.equal(snapshot(db).balance, 1250);
    assert.deepEqual(notificationRow(db, noticeId), stored);
    assert.deepEqual(snapshot(db).tables, moneyBefore.tables);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('reopening after the undo applies version 59 again and does not rewrite the old rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'vib-fcm-reopen-'));
  const path = join(root, 'local.sqlite');
  const now = new Date().toISOString();
  const first = openDatabase(path);
  first
    .prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run('e2e-user', 'e2e-user', 'مستخدم تجريبي', 'hash', 'admin', 'org-default', 'branch-main', now, now);
  first
    .prepare(
      `INSERT INTO customers(id,name,normalized_name,organization_id,section_key,current_balance_units,created_at,updated_at)
       VALUES(?,?,?, 'org-default','customer_debts',1250,?,?)`,
    )
    .run('e2e-customer', 'عميل تجريبي', 'e2e-customer', now, now);
  const notice = first
    .prepare(
      `INSERT INTO notifications(organization_id,recipient_user_id,action,entity_type,details_json,created_at)
       VALUES(?,?,'customer.debt','customer','{"amountUnits":1250}',?)`,
    )
    .run('org-default', 'e2e-user', now);
  rollbackMobilePush(first);
  first.close();
  const again = openDatabase(path);
  try {
    assert.equal(again.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get()?.v, 59);
    assert.equal(
      again.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get('e2e-customer')?.n,
      1250,
    );
    assert.equal(
      again.prepare('SELECT details_json FROM notifications WHERE id=?').get(notice.lastInsertRowid)
        ?.details_json,
      '{"amountUnits":1250}',
    );
    assert.equal(again.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n, 0);
  } finally {
    again.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function snapshot(db: ReturnType<typeof openDatabase>) {
  const columns = (table: string) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => String(column.name));
  return {
    balance: Number(
      db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get('e2e-customer')?.n,
    ),
    debts: Number(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()?.n),
    treasury: Number(db.prepare('SELECT COUNT(*) n FROM treasury_transactions').get()?.n),
    tables: {
      customers: columns('customers'),
      debt_transactions: columns('debt_transactions'),
      treasury_transactions: columns('treasury_transactions'),
      notifications: columns('notifications'),
    },
  };
}

function notificationRow(db: ReturnType<typeof openDatabase>, id: number) {
  return db
    .prepare(
      'SELECT action, entity_type, details_json, recipient_user_id, read_at FROM notifications WHERE id=?',
    )
    .get(id) as {
    action: string;
    entity_type: string;
    details_json: string;
    recipient_user_id: string;
    read_at: string | null;
  };
}
