import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../src/server/domain/notifications.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';
import { notificationSentence } from '../src/client/assistant/notificationModel.ts';
import {
  NOTIFICATION_REALTIME_TOPICS,
  NOTIFICATION_SAFETY_POLL_INTERVAL_MS,
} from '../src/client/assistant/notificationRealtime.ts';

const databases: AppDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });

function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const now = new Date().toISOString();
  const addUser = db.prepare(`INSERT INTO users(
    id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  addUser.run('admin-notices', 'admin-notices', 'مدير الإشعارات', 'test-hash', 'admin', 'org-default', 'branch-main', now, now);
  addUser.run('employee-notices', 'employee-notices', 'الصغير', 'test-hash', 'employee', 'org-default', 'branch-main', now, now);
  const actor: AuthenticatedUser = {
    id: 'admin-notices', username: 'admin-notices', displayName: 'مدير الإشعارات', role: 'admin',
    organizationId: 'org-default', homeBranchId: 'branch-main', mustChangePassword: false,
    permissions: new Set(), sessionTokenHash: 'session', csrfHash: 'csrf',
  };
  return { db, actor, now };
}

test('reading notifications removes them so the center never accumulates read items', () => {
  const { db, actor, now } = setup();
  const insert = db.prepare(`INSERT INTO notifications(
    organization_id,recipient_user_id,actor_user_id,action,entity_type,entity_id,
    section_key,details_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  insert.run('org-default', actor.id, 'employee-notices', 'collection.submit', 'collection_submission', 's-1', 'collections', JSON.stringify({
    paymentMode: 'full', amountUnits: 5000, subjectName: 'محمد', subjectSection: 'customer_debts',
  }), now);
  insert.run('org-default', actor.id, 'employee-notices', 'customer.debt', 'debt_transaction', 't-1', 'customers', JSON.stringify({
    amountUnits: 1000, subjectName: 'علي', subjectSection: 'customer_debts',
  }), now);

  const first = listNotifications(db, actor, new URL('https://localhost/api/notifications'));
  assert.equal(first.items.length, 2);
  assert.equal(first.unreadCount, 2);
  markNotificationRead(db, actor, first.items[0]!.id);
  assert.equal(listNotifications(db, actor, new URL('https://localhost/api/notifications')).items.length, 1);
  markAllNotificationsRead(db, actor);
  const empty = listNotifications(db, actor, new URL('https://localhost/api/notifications'));
  assert.equal(empty.items.length, 0);
  assert.equal(empty.unreadCount, 0);
});

test('employee notification states the exact collection action, amount, and customer', () => {
  const sentence = notificationSentence({
    id: 1,
    action: 'collection.submit',
    entityType: 'collection_submission',
    entityId: 'submission-1',
    sectionKey: 'collections',
    details: {
      paymentMode: 'partial',
      amountUnits: 2000,
      subjectName: 'شركة البيان',
      subjectSection: 'company_debts',
    },
    actorName: 'الصغير',
    actorUsername: 'alsaghir',
    actorRole: 'employee',
    createdAt: '2026-10-07T12:00:00.000Z',
    readAt: null,
  });
  assert.equal(sentence, 'الموظف الصغير سجّل تسديدًا جزئيًا بقيمة 2,000 د.ل للشركة شركة البيان.');
});

test('purchase notifications describe standalone payment, Vodafone consumption, and combined entries', () => {
  const base = {
    id: 2,
    entityType: 'purchase_entry',
    entityId: 'purchase-1',
    sectionKey: 'purchases',
    actorName: 'الصغير',
    actorUsername: 'alsaghir',
    actorRole: 'employee',
    createdAt: '2026-10-08T12:00:00.000Z',
    readAt: null,
  } as const;
  assert.equal(notificationSentence({
    ...base,
    action: 'purchases.entry.create',
    details: { subjectName: 'تسديد', amountUnits: 0, paidUnits: 100, vodafoneConsumedUnits: 0 },
  }), 'الموظف الصغير سجّل تسديد 100 د.ل.');
  assert.equal(notificationSentence({
    ...base,
    action: 'purchases.entry.create',
    details: { subjectName: 'مستهلك فودافون', amountUnits: 0, paidUnits: 0, vodafoneConsumedUnits: 250 },
  }), 'الموظف الصغير سجّل استهلاك فودافون 250 ج.م.');
  assert.equal(notificationSentence({
    ...base,
    action: 'purchases.entry.update',
    details: { subjectName: 'فودافون', amountUnits: 500, paidUnits: 100, vodafoneConsumedUnits: 50 },
  }), 'الموظف الصغير سجّل شراء (فودافون) بقيمة 500 د.ل، تسديد 100 د.ل، استهلاك فودافون 50 ج.م.');
});

test('notification refresh covers every account financial event and has a bounded recovery poll', () => {
  const topics = new Set<string>(NOTIFICATION_REALTIME_TOPICS);
  assert.ok(topics.has('customer.ledger.changed'));
  assert.ok(topics.has('company.ledger.changed'));
  assert.ok(topics.has('libyan-deposit.ledger.changed'));
  assert.ok(topics.has('egyptian-deposit.ledger.changed'));
  assert.ok(topics.has('collection.changed'));
  assert.ok(topics.has('masraweya.changed'));
  assert.ok(topics.has('purchases.changed'));
  assert.ok(topics.has('treasury.changed'));
  assert.ok(NOTIFICATION_SAFETY_POLL_INTERVAL_MS >= 2_000);
  assert.ok(NOTIFICATION_SAFETY_POLL_INTERVAL_MS <= 5_000);
});

test('every employee financial audit creates an administration notification', () => {
  const { db, actor, now } = setup();
  const actions = [
    'customer.debt',
    'customer.payment',
    'company.debt',
    'company.payment',
    'libyan_deposit.debt',
    'libyan_deposit.payment',
    'egyptian_deposit.debt',
    'egyptian_deposit.payment',
    'collection.submit',
    'masraweya.day.save',
    'purchases.entry.create',
    'treasury.cash.in',
    'treasury.cash.out',
  ];
  const insertAudit = db.prepare(`INSERT INTO audit_log(
    actor_user_id,organization_id,action,entity_type,entity_id,
    correlation_id,outcome,details_json,created_at
  ) VALUES(?,?,?,?,?,?,'success',?,?)`);
  actions.forEach((action, index) => insertAudit.run(
    'employee-notices',
    'org-default',
    action,
    'financial_test',
    `entity-${index}`,
    `correlation-${index}`,
    JSON.stringify({ amountUnits: 100 + index, subjectName: `حساب ${index}` }),
    now,
  ));

  const result = listNotifications(db, actor, new URL('https://localhost/api/notifications?limit=100'));
  assert.equal(result.unreadCount, actions.length);
  assert.deepEqual(new Set(result.items.map((item) => item.action)), new Set(actions));
});
