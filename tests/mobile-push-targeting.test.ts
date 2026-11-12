import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import {
  createMobilePushDispatcher,
  mobilePushAllowed,
  registerMobileDevice,
  type FcmMessage,
} from '../src/server/domain/mobilePush.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const account = {
  projectId: 'vib-test',
  clientEmail: 'push@vib-test.iam.gserviceaccount.com',
  privateKey: 'unused',
};

test('the push rule is narrower than the in-app recipient list', () => {
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'admin',
      actorRole: 'employee',
      action: 'customer.debt',
      collectionsRead: false,
    }),
    true,
  );
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'admin',
      actorRole: 'admin',
      action: 'user.update',
      collectionsRead: false,
    }),
    true,
  );
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'employee',
      actorRole: 'admin',
      action: 'collection.assign',
      collectionsRead: true,
    }),
    true,
  );
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'employee',
      actorRole: 'admin',
      action: 'collection.assign',
      collectionsRead: false,
    }),
    false,
  );
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'employee',
      actorRole: 'employee',
      action: 'customer.debt',
      collectionsRead: true,
    }),
    false,
  );
  assert.equal(
    mobilePushAllowed({
      recipientRole: 'employee',
      actorRole: 'admin',
      action: 'collection.payroll.entry.create',
      collectionsRead: true,
    }),
    false,
  );
});

test('admins get every employee transaction, and only a collections employee gets an assignment', async () => {
  const db = openDatabase(':memory:');
  const now = new Date().toISOString();
  const users = [
    user('admin-a', 'admin'),
    user('admin-b', 'admin'),
    user('collector', 'employee'),
    user('plain', 'employee'),
    user('worker', 'employee'),
  ];
  for (const person of users) {
    db.prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      person.id,
      person.username,
      person.displayName,
      'hash',
      person.role,
      person.organizationId,
      person.homeBranchId,
      now,
      now,
    );
  }
  db.prepare(
    `INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)`,
  ).run('collector', 'collections.read', now);
  const tokens: Record<string, string> = {
    'admin-a': 'A'.repeat(40),
    'admin-b': 'B'.repeat(40),
    collector: 'C'.repeat(40),
    plain: 'D'.repeat(40),
    worker: 'E'.repeat(40),
  };
  for (const person of users) {
    registerMobileDevice(db, person, { token: tokens[person.id], platform: 'android' });
  }
  const sent: FcmMessage[] = [];
  const dispatcher = createMobilePushDispatcher(db, account, async (message) => {
    sent.push(message);
  });
  try {
    audit(db, 'worker', 'customer.debt', 'cust-1', {
      amountUnits: 2500,
      customerName: 'عميل تجريبي',
    });
    const afterDebt = recipients(db, 'customer.debt');
    assert.deepEqual(afterDebt, ['admin-a', 'admin-b']);
    await dispatcher.drain();
    assert.deepEqual(
      sent.map((message) => message.token).sort(),
      [tokens['admin-a'], tokens['admin-b']].sort(),
    );
    for (const message of sent) {
      assert.equal(message.body.includes('2500'), true);
      assert.equal(message.body.includes('عميل تجريبي'), true);
      assert.equal(message.body.includes('إضافة دين عميل'), true);
    }
    assert.deepEqual(recipients(db, 'customer.debt'), afterDebt);

    sent.length = 0;
    audit(db, 'admin-a', 'collection.assign', 'assign-1', {
      assigneeId: 'collector',
      customerIds: ['cust-1'],
      section: 'customers',
    });
    const afterAssign = recipients(db, 'collection.assign');
    assert.deepEqual(afterAssign, ['admin-b', 'collector']);
    await dispatcher.drain();
    assert.deepEqual(
      sent.map((message) => message.token).sort(),
      [tokens['admin-b'], tokens.collector].sort(),
    );
    assert.equal(
      sent.some((message) => message.body.includes('توجيه كروت')),
      true,
    );
    assert.deepEqual(recipients(db, 'collection.assign'), afterAssign);

    sent.length = 0;
    audit(db, 'admin-a', 'collection.assign', 'assign-2', {
      assigneeId: 'plain',
      customerIds: ['cust-2'],
      section: 'customers',
    });
    assert.equal(recipients(db, 'collection.assign').includes('plain'), true);
    await dispatcher.drain();
    assert.deepEqual(
      sent.map((message) => message.token),
      [tokens['admin-b']],
    );

    sent.length = 0;
    db.prepare(
      `INSERT INTO notifications(organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,section_key,details_json,created_at)
       VALUES(?,?,?,'collection.payroll.entry.create','collection_payroll_entry','pay-1','collections',?,?)`,
    ).run('org-default', 'collector', 'admin-a', JSON.stringify({ amountUnits: 40 }), now);
    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM notifications WHERE action='collection.payroll.entry.create'`).get()?.n,
      1,
    );
    await dispatcher.drain();
    assert.equal(sent.length, 0);
    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM notifications WHERE action='collection.payroll.entry.create'`).get()?.n,
      1,
    );

    sent.length = 0;
    audit(db, 'admin-a', 'user.update', 'admin-b', { role: 'admin', permissions: ['collections.read'] });
    assert.deepEqual(recipients(db, 'user.update'), ['admin-b']);
    await dispatcher.drain();
    assert.deepEqual(
      sent.map((message) => message.token),
      [tokens['admin-b']],
    );
    assert.equal(sent[0].body.includes('collections.read'), true);
  } finally {
    dispatcher.stop();
    db.close();
  }
});

function user(id: string, role: 'admin' | 'employee'): AuthenticatedUser {
  return {
    id,
    username: id,
    displayName: id,
    role,
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: id,
    csrfHash: 'csrf',
  };
}

function audit(
  db: ReturnType<typeof openDatabase>,
  actorId: string,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  db.prepare(
    `INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
     VALUES(?,?,?,?,?,?,'success',?,?)`,
  ).run(
    actorId,
    'org-default',
    action,
    'customer',
    entityId,
    `corr-${entityId}`,
    JSON.stringify(details),
    new Date().toISOString(),
  );
}

function recipients(db: ReturnType<typeof openDatabase>, action: string) {
  return db
    .prepare('SELECT recipient_user_id FROM notifications WHERE action=? ORDER BY recipient_user_id')
    .all(action)
    .map((row) => String(row.recipient_user_id));
}
