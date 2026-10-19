import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createECDH, randomBytes } from 'node:crypto';
import webPush from 'web-push';
import { openDatabase, inImmediateTransaction } from '../src/server/db/database.ts';
import {
  createPushDispatcher,
  registerPush,
  removePush,
  queuePushTest,
  validatePushSubscription,
  pushSettings,
} from '../src/server/domain/browserPush.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';
import type { ServerConfig } from '../src/server/config.ts';
const vapid = webPush.generateVAPIDKeys();
const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  sessionHours: 12,
  secureCookie: false,
  internetRequired: false,
  internetProbeUrls: [],
  internetProbeTimeoutMs: 1,
  internetProbeCacheMs: 1,
  pushPublicKey: vapid.publicKey,
  pushPrivateKey: vapid.privateKey,
  pushSubject: 'https://vip2100.com',
};
function fixture() {
  const db = openDatabase(':memory:');
  const actor: AuthenticatedUser = {
    id: 'push-admin',
    username: 'push-admin',
    displayName: 'مدير',
    role: 'admin',
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'push-session',
    csrfHash: 'csrf',
  };
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(
    actor.id,
    actor.username,
    actor.displayName,
    'hash',
    'admin',
    actor.organizationId,
    actor.homeBranchId,
    now,
    now,
  );
  db.prepare(
    'INSERT INTO sessions(token_hash,user_id,csrf_hash,client_api_version,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?,?)',
  ).run(
    actor.sessionTokenHash,
    actor.id,
    'csrf',
    '1',
    now,
    now,
    new Date(Date.now() + 3600000).toISOString(),
  );
  const key = createECDH('prime256v1');
  key.generateKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
    keys: { p256dh: key.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  const notice = () =>
    db
      .prepare(
        "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.debt','customer',?,?)",
      )
      .run(
        actor.organizationId,
        actor.id,
        actor.id,
        JSON.stringify({ subjectName: 'اسم خاص', amountUnits: 5000 }),
        now,
      );
  return { db, actor, subscription, notice };
}
test('push validates trusted providers and rejects invalid encryption keys and configuration', () => {
  const { db, subscription } = fixture();
  try {
    assert.ok(pushSettings(config));
    assert.equal(pushSettings({ ...config, pushPrivateKey: 'bad' }), null);
    assert.equal(validatePushSubscription(subscription).endpoint, subscription.endpoint);
    for (const endpoint of [
      'http://fcm.googleapis.com/p',
      'https://127.0.0.1/p',
      'https://fcm.googleapis.com.evil.example/p',
      'https://user@fcm.googleapis.com/p',
      'https://fcm.googleapis.com:8443/p',
    ])
      assert.throws(() => validatePushSubscription({ ...subscription, endpoint }));
    assert.throws(() =>
      validatePushSubscription({ ...subscription, keys: { p256dh: 'A'.repeat(87), auth: 'A'.repeat(22) } }),
    );
  } finally {
    db.close();
  }
});
test('push is transactional, excludes old/read notifications and encrypts actor and action without financial details', async () => {
  const { db, actor, subscription, notice } = fixture();
  const delivered: string[] = [];
  const dispatcher = createPushDispatcher(db, config, async (sub, payload, options) => {
    const request = webPush.generateRequestDetails(sub, payload, options);
    assert.ok(request.body);
    assert.ok(request.headers.Authorization || request.headers.authorization);
    delivered.push(payload);
  });
  try {
    notice();
    registerPush(db, actor, subscription);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_outbox').get()!.n, 0);
    assert.throws(() =>
      inImmediateTransaction(db, () => {
        notice();
        throw Error('rollback');
      }),
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_outbox').get()!.n, 0);
    notice();
    await dispatcher.drain();
    assert.equal(delivered.length, 1);
    assert.equal(JSON.parse(delivered[0]).title, 'VIB Abdo Company');
    assert.equal(JSON.parse(delivered[0]).body, 'مدير — إضافة دين عميل');
    assert.ok(!delivered[0].includes('5000'));
    assert.ok(!delivered[0].includes('اسم خاص'));
    const read = notice();
    db.prepare('DELETE FROM notifications WHERE id=?').run(read.lastInsertRowid);
    await dispatcher.drain();
    assert.equal(delivered.length, 1);
    removePush(db, { ...actor, id: 'different' }, subscription.endpoint);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 1);
    removePush(db, actor, subscription.endpoint);
    notice();
    await dispatcher.drain();
    assert.equal(delivered.length, 1);
  } finally {
    dispatcher.stop();
    db.close();
  }
});
test('push retries transient failures without duplication and retires expired endpoints', async () => {
  const { db, actor, subscription, notice } = fixture();
  let attempt = 0;
  const dispatcher = createPushDispatcher(db, config, async () => {
    attempt++;
    throw Object.assign(Error('temporary'), { statusCode: attempt === 1 ? 503 : 410 });
  });
  try {
    registerPush(db, actor, subscription);
    notice();
    await dispatcher.drain();
    assert.equal(db.prepare('SELECT attempts FROM browser_push_outbox').get()!.attempts, 1);
    await dispatcher.drain();
    assert.equal(attempt, 1);
    db.prepare('UPDATE browser_push_outbox SET next_attempt_at=0').run();
    await dispatcher.drain();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_outbox').get()!.n, 0);
  } finally {
    dispatcher.stop();
    db.close();
  }
});
test('logout keeps the device subscription; test requests are throttled', async () => {
  const { db, actor, subscription, notice } = fixture();
  let sent = 0;
  const dispatcher = createPushDispatcher(db, config, async () => {
    sent++;
  });
  try {
    assert.throws(() => registerPush(db, { ...actor, role: 'employee' }, subscription));
    registerPush(db, actor, subscription);
    queuePushTest(db, actor, subscription.endpoint);
    assert.throws(() => queuePushTest(db, actor, subscription.endpoint));
    db.prepare('UPDATE sessions SET revoked_at=?').run(new Date().toISOString());
    notice();
    await dispatcher.drain();
    assert.equal(sent, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 1);
  } finally {
    dispatcher.stop();
    db.close();
  }
});

for (const reason of ['disabled', 'permission', 'password-reset'] as const) {
  test('queued push is discarded when recipient is ' + reason, async () => {
    const { db, actor, subscription, notice } = fixture();
    let sent = 0;
    const dispatcher = createPushDispatcher(db, config, async () => {
      sent++;
    });
    try {
      registerPush(db, actor, subscription);
      notice();
      if (reason === 'disabled') db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(actor.id);
      if (reason === 'permission') db.prepare("UPDATE users SET role='employee' WHERE id=?").run(actor.id);
      if (reason === 'password-reset')
        db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(actor.id);
      await dispatcher.drain();
      assert.equal(sent, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions').get()!.n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_push_outbox').get()!.n, 0);
    } finally {
      dispatcher.stop();
      db.close();
    }
  });
}
