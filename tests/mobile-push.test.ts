import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { createApp, listen } from '../src/server/app.ts';
import { API_VERSION, loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';
import {
  mobilePushRollbackSql,
  mobilePushShadeRollbackSql,
  rollbackMobilePushShade,
} from '../src/server/db/migrationsMobilePush.ts';
import {
  authorizeFcm,
  createMobilePushDispatcher,
  fcmChannelId,
  fcmDropsDevice,
  fcmMessageBody,
  FcmRequestError,
  loadFcmAccount,
  resetFcmAccessCache,
  parseFcmAccount,
  deviceRequestsShade,
  registerMobileDevice,
  shadeCapability,
  shadeData,
  type FcmMessage,
} from '../src/server/domain/mobilePush.ts';
import { SESSION_COOKIE, createSession } from '../src/server/security/sessions.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const account = {
  projectId: 'vib-test',
  clientEmail: 'push@vib-test.iam.gserviceaccount.com',
  privateKey: pem,
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
  const other: AuthenticatedUser = { ...actor, id: 'other-user', username: 'other' };
  const employee: AuthenticatedUser = {
    ...actor,
    id: 'employee-actor',
    username: 'employee-actor',
    role: 'employee',
  };
  const now = new Date().toISOString();
  for (const user of [actor, other, employee]) {
    db.prepare(
      'INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      user.id,
      user.username,
      user.displayName,
      'hash',
      user.role,
      user.organizationId,
      user.homeBranchId,
      now,
      now,
    );
  }
  const token = 'a'.repeat(40);
  return { db, actor, other, employee, token };
}

test('credentials are off when the file is absent and the key is not logged', () => {
  const logs: unknown[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      logs.push(args);
    };
  }
  try {
    assert.equal(loadFcmAccount({}), null);
    assert.equal(parseFcmAccount('not-json'), null);
    assert.equal(parseFcmAccount(JSON.stringify({ project_id: 'p' })), null);
    const parsed = parseFcmAccount(
      JSON.stringify({
        project_id: 'vib-test',
        client_email: 'push@vib-test.iam.gserviceaccount.com',
        private_key: pem,
      }),
    );
    assert.equal(parsed?.projectId, 'vib-test');
    assert.equal(JSON.stringify(logs).includes('BEGIN PRIVATE KEY'), false);
    assert.equal(JSON.stringify(logs).includes(pem), false);
  } finally {
    for (const method of methods) console[method] = originals[method]!;
  }
});

test('a device token registers and unregisters only for its user', () => {
  const { db, actor, other, token } = fixture();
  assert.deepEqual(registerMobileDevice(db, actor, { token, platform: 'android' }), {
    registered: true,
  });
  assert.equal(
    db.prepare('SELECT user_id FROM mobile_push_devices WHERE token=?').get(token)?.user_id,
    actor.id,
  );
  assert.deepEqual(registerMobileDevice(db, other, { token, platform: 'android', unregister: true }), {
    registered: false,
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 1);
  assert.deepEqual(registerMobileDevice(db, actor, { token, platform: 'android', unregister: true }), {
    registered: false,
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 0);
});

test('a new notification is sent on the sound channel and an UNREGISTERED token is removed', async () => {
  const { db, actor, other, employee, token } = fixture();
  registerMobileDevice(db, actor, { token, platform: 'android' });
  const sent: FcmMessage[] = [];
  const dispatcher = createMobilePushDispatcher(db, account, async (message) => {
    sent.push(message);
  });
  const otherToken = 'b'.repeat(40);
  registerMobileDevice(db, other, { token: otherToken, platform: 'android' });
  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.debt','customer','{}',?)",
  ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
  await dispatcher.drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, token);
  assert.equal(sent[0].channelId, fcmChannelId);
  assert.equal(sent[0].data.recipientUserId, actor.id);
  assert.equal(fcmMessageBody(sent[0]).message.notification?.title, 'VIB');
  assert.equal(fcmMessageBody(sent[0]).message.android.notification?.channel_id, fcmChannelId);
  assert.equal(fcmMessageBody(sent[0]).message.android.priority, 'HIGH');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n, 0);

  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.payment','customer','{}',?)",
  ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
  const failing = createMobilePushDispatcher(db, account, async () => {
    const error = new Error('gone') as Error & { status: number; errorCode: string };
    error.status = 404;
    error.errorCode = 'UNREGISTERED';
    throw error;
  });
  await failing.drain();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices WHERE token=?').get(token)?.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices WHERE token=?').get(otherToken)?.n, 1);
  dispatcher.stop();
  failing.stop();
});

test('no service account means nothing is sent', async () => {
  const { db, actor, token } = fixture();
  registerMobileDevice(db, actor, { token, platform: 'android' });
  let calls = 0;
  const dispatcher = createMobilePushDispatcher(db, null, async () => {
    calls += 1;
  });
  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,action,entity_type,details_json,created_at) VALUES(?,?,'customer.debt','customer','{}',?)",
  ).run(actor.organizationId, actor.id, new Date().toISOString());
  await dispatcher.drain();
  assert.equal(calls, 0);
  assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n), 1);
  dispatcher.stop();
});

test('HTTP v1 posts the sound channel and drops an UNREGISTERED token', async () => {
  const { db, actor, employee, token } = fixture();
  registerMobileDevice(db, actor, { token, platform: 'android' });
  const calls: Array<{ url: string; body: string }> = [];
  const original = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    calls.push({ url, body });
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'access-test' }), { status: 200 });
    }
    if (fail) {
      return new Response(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }), {
        status: 404,
      });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const dispatcher = createMobilePushDispatcher(db, account);
    db.prepare(
      "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.debt','customer','{}',?)",
    ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
    await dispatcher.drain();
    const send = calls.find((call) => call.url.includes('/messages:send'));
    assert.ok(send);
    assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/vib-test/messages:send');
    const body = JSON.parse(send.body) as {
      message: { token: string; android: { priority: string; notification: { channel_id: string } } };
    };
    assert.equal(body.message.token, token);
    assert.equal(body.message.android.priority, 'HIGH');
    assert.equal(body.message.android.notification.channel_id, fcmChannelId);
    assert.equal(
      calls.some((call) => call.body.includes('BEGIN PRIVATE KEY')),
      false,
    );
    fail = true;
    db.prepare(
      "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.payment','customer','{}',?)",
    ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
    await dispatcher.drain();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 0);
    dispatcher.stop();
  } finally {
    globalThis.fetch = original;
  }
});

test('the device route requires the session CSRF and stays on that user', async () => {
  const { db, actor, other, token } = fixture();
  const session = createSession(db, actor.id, API_VERSION, 12);
  const otherSession = createSession(db, other.id, API_VERSION, 12);
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
    { internetCheck: async () => true },
  );
  await listen(server, '127.0.0.1', 0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/api/mobile-push/devices`;
  const origin = `http://127.0.0.1:${port}`;
  try {
    const denied = await fetch(url, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${session.token}`,
        origin,
        'content-type': 'application/json',
        'x-client-api-version': API_VERSION,
      },
      body: JSON.stringify({ token, platform: 'android' }),
    });
    assert.equal(denied.status, 403);
    const allowed = await fetch(url, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${session.token}`,
        origin,
        'content-type': 'application/json',
        'x-client-api-version': API_VERSION,
        'x-csrf-token': session.csrfToken,
      },
      body: JSON.stringify({ token, platform: 'android' }),
    });
    assert.equal(allowed.status, 200);
    const stolen = await fetch(url, {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=${otherSession.token}`,
        origin,
        'content-type': 'application/json',
        'x-client-api-version': API_VERSION,
        'x-csrf-token': otherSession.csrfToken,
      },
      body: JSON.stringify({ token, platform: 'android', unregister: true }),
    });
    assert.equal(stolen.status, 200);
    assert.equal(
      db.prepare('SELECT user_id FROM mobile_push_devices WHERE token=?').get(token)?.user_id,
      actor.id,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an invalid token is dropped and a bad payload is retried', async () => {
  assert.equal(
    fcmDropsDevice(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        details: [
          { errorCode: 'INVALID_ARGUMENT' },
          { fieldViolations: [{ field: 'message.token', description: 'bad' }] },
        ],
      },
    }),
    true,
  );
  assert.equal(
    fcmDropsDevice(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        details: [{ errorCode: 'INVALID_ARGUMENT', fieldViolations: [{ field: 'message.notification' }] }],
      },
    }),
    false,
  );
  assert.equal(fcmDropsDevice(404, { error: { details: [{ errorCode: 'UNREGISTERED' }] } }), true);
  const { db, actor, employee, token } = fixture();
  registerMobileDevice(db, actor, { token, platform: 'android' });
  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.debt','customer','{}',?)",
  ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
  const dropping = createMobilePushDispatcher(db, account, async () => {
    throw new FcmRequestError(400, 'INVALID_ARGUMENT', true);
  });
  await dropping.drain();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n, 0);
  dropping.stop();
  registerMobileDevice(db, actor, { token, platform: 'android' });
  db.prepare(
    "INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,'customer.debt','customer','{}',?)",
  ).run(actor.organizationId, actor.id, employee.id, new Date().toISOString());
  const retrying = createMobilePushDispatcher(db, account, async () => {
    throw new FcmRequestError(400, 'INVALID_ARGUMENT', false);
  });
  await retrying.drain();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 1);
  assert.equal(db.prepare('SELECT attempts FROM mobile_push_outbox').get()?.attempts, 1);
  retrying.stop();
});

test('the access token is reused until five minutes before expiry', async () => {
  resetFcmAccessCache();
  let oauth = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes('oauth2.googleapis.com')) throw new Error(url);
    oauth += 1;
    return new Response(JSON.stringify({ access_token: 'cached-access', expires_in: 3600 }), {
      status: 200,
    });
  };
  try {
    const start = 1_000_000;
    assert.equal(await authorizeFcm(account, start), 'cached-access');
    assert.equal(await authorizeFcm(account, start + 60_000), 'cached-access');
    assert.equal(oauth, 1);
    assert.equal(await authorizeFcm(account, start + 3300 * 1000), 'cached-access');
    assert.equal(oauth, 2);
  } finally {
    globalThis.fetch = original;
    resetFcmAccessCache();
  }
});

test('an unknown device keeps the legacy notification and a shade device gets data only', async () => {
  const { db, actor, employee, token } = fixture();
  const createdAt = '2026-11-14T13:25:00.000Z';
  const details = {
    subjectName: 'سالم',
    subjectSection: 'customers',
    amountUnits: 1500,
    paymentMode: 'partial',
    currency: 'LYD',
    empty: '',
    missing: null,
    nested: { phone: '091' },
    password: 'hidden-password',
    token: 'hidden-token',
    secret: 'hidden-secret',
    hash: 'hidden-hash',
    csrf: 'hidden-csrf',
  };
  registerMobileDevice(db, actor, { token, platform: 'android' });
  assert.equal(deviceRequestsShade({}), false);
  assert.equal(deviceRequestsShade({ pushCapabilities: 'shade_v1' }), false);
  assert.equal(deviceRequestsShade({ pushCapabilities: ['shade_v2'] }), false);
  assert.equal(
    db.prepare('SELECT push_capabilities FROM mobile_push_devices WHERE token=?').get(token)
      ?.push_capabilities,
    null,
  );
  const legacySent: FcmMessage[] = [];
  const legacy = createMobilePushDispatcher(db, account, async (message) => {
    legacySent.push(message);
  });
  db.prepare(
    'INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(
    actor.organizationId,
    actor.id,
    employee.id,
    'customer.payment',
    'customer',
    JSON.stringify(details),
    createdAt,
  );
  await legacy.drain();
  assert.equal(legacySent.length, 1);
  const legacyWire = fcmMessageBody(legacySent[0]);
  assert.equal(legacyWire.message.notification?.title, 'VIB');
  assert.equal(legacyWire.message.notification?.body, legacySent[0].body);
  assert.equal(legacyWire.message.android.priority, 'HIGH');
  assert.equal(legacyWire.message.android.notification?.channel_id, fcmChannelId);
  assert.deepEqual(legacySent[0].data, {
    notificationId: String(legacySent[0].data.notificationId),
    recipientUserId: actor.id,
    operationType: 'customer.payment',
  });
  assert.equal('subjectName' in legacySent[0].data, false);
  assert.equal(JSON.stringify(legacyWire).includes('hidden-password'), false);
  legacy.stop();

  registerMobileDevice(db, actor, {
    token,
    platform: 'android',
    pushCapabilities: [shadeCapability, 'not-a-capability'],
  });
  assert.equal(
    db.prepare('SELECT push_capabilities FROM mobile_push_devices WHERE token=?').get(token)
      ?.push_capabilities,
    shadeCapability,
  );
  const shadeSent: FcmMessage[] = [];
  const shaded = createMobilePushDispatcher(db, account, async (message) => {
    shadeSent.push(message);
  });
  db.prepare(
    'INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,details_json,created_at) VALUES(?,?,?,?,?,?,?)',
  ).run(
    actor.organizationId,
    actor.id,
    employee.id,
    'customer.payment',
    'customer',
    JSON.stringify(details),
    createdAt,
  );
  await shaded.drain();
  assert.equal(shadeSent.length, 1);
  const wire = fcmMessageBody(shadeSent[0]);
  assert.equal(shadeSent[0].shade, true);
  assert.equal(wire.message.notification, undefined);
  assert.equal(wire.message.android.notification, undefined);
  assert.equal(wire.message.android.priority, 'HIGH');
  assert.equal(wire.message.data.subjectName, 'سالم');
  assert.equal(wire.message.data.subjectSection, 'customers');
  assert.equal(wire.message.data.amountUnits, '1500');
  assert.equal(wire.message.data.paymentMode, 'partial');
  assert.equal(wire.message.data.currency, 'LYD');
  assert.equal(wire.message.data.actorName, employee.displayName);
  assert.equal(wire.message.data.actorRole, 'employee');
  assert.equal(wire.message.data.createdAt, createdAt);
  assert.equal(wire.message.data.operationType, 'customer.payment');
  for (const secret of [
    'password',
    'token',
    'secret',
    'hash',
    'csrf',
    'empty',
    'missing',
    'nested',
    'phone',
  ]) {
    assert.equal(secret in wire.message.data, false, secret);
  }
  assert.equal(JSON.stringify(wire).includes('hidden-'), false);
  assert.equal(JSON.stringify(wire).includes('091'), false);
  shaded.stop();

  registerMobileDevice(db, actor, { token, platform: 'android' });
  assert.equal(
    db.prepare('SELECT push_capabilities FROM mobile_push_devices WHERE token=?').get(token)
      ?.push_capabilities,
    null,
  );
  const coerced = shadeData(
    { amountUnits: 1500, subjectName: '  ', reason: false, paidUnits: Number.NaN },
    'أحمد',
    null,
    '',
  );
  assert.equal(coerced.amountUnits, '1500');
  assert.equal(coerced.reason, 'false');
  assert.equal('subjectName' in coerced, false);
  assert.equal('paidUnits' in coerced, false);
  assert.equal('createdAt' in coerced, false);
  assert.equal(coerced.actorName, 'أحمد');
});

test('version 60 rolls back by dropping only the capability column', () => {
  const { db, actor, token } = fixture();
  registerMobileDevice(db, actor, { token, platform: 'android', pushCapabilities: [shadeCapability] });
  assert.equal(
    db.prepare('SELECT push_capabilities FROM mobile_push_devices WHERE token=?').get(token)
      ?.push_capabilities,
    shadeCapability,
  );
  rollbackMobilePushShade(db);
  const columns = db
    .prepare('PRAGMA table_info(mobile_push_devices)')
    .all()
    .map((row) => String(row.name));
  assert.equal(columns.includes('push_capabilities'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=60').get()?.n, 0);
  assert.equal(mobilePushShadeRollbackSql.includes('DROP TABLE'), false);
});

test('version 59 rolls back by dropping only the mobile push tables', () => {
  const { db } = fixture();
  db.exec(mobilePushRollbackSql);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'mobile_push%'")
    .all()
    .map((row) => String(row.name));
  assert.deepEqual(names, []);
});
