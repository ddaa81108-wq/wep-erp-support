import { browserPushMessage } from './browserPushMessage.ts';
import { createECDH, randomUUID } from 'node:crypto';
import webPush from 'web-push';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import type { ServerConfig } from '../config.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { badRequest, conflict, forbidden } from '../http/errors.ts';

export function pushSettings(config: ServerConfig) {
  if (!config.pushPublicKey || !config.pushPrivateKey || !config.pushSubject) return null;
  try {
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(config.pushPrivateKey, 'base64url'));
    if (key.getPublicKey('base64url') !== config.pushPublicKey) return null;
    const subject = new URL(config.pushSubject);
    if (!['https:', 'mailto:'].includes(subject.protocol)) return null;
    return {
      publicKey: config.pushPublicKey,
      privateKey: config.pushPrivateKey,
      subject: config.pushSubject,
    };
  } catch {
    return null;
  }
}
export function requirePushUser(user: AuthenticatedUser) {
  if (user.role !== 'admin' && !user.permissions.has('collections.read'))
    throw forbidden('notifications.read');
}
export function validatePushSubscription(input: Record<string, unknown>) {
  const endpoint = String(input.endpoint ?? '');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest('INVALID_PUSH_ENDPOINT', 'عنوان اشتراك الإشعارات غير صالح.');
  }
  const host = url.hostname;
  const allowed =
    host === 'fcm.googleapis.com' ||
    host === 'web.push.apple.com' ||
    host.endsWith('.push.services.mozilla.com') ||
    host.endsWith('.notify.windows.com');
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    endpoint.length > 4096
  )
    throw badRequest('INVALID_PUSH_ENDPOINT', 'خدمة إشعارات هذا المتصفح غير مدعومة.');
  const keys = input.keys as Record<string, unknown> | undefined;
  const p256dh = String(keys?.p256dh ?? ''),
    auth = String(keys?.auth ?? '');
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth))
    throw badRequest('INVALID_PUSH_KEYS', 'مفاتيح اشتراك المتصفح غير صالحة.');
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(Buffer.from(p256dh, 'base64url'));
  } catch {
    throw badRequest('INVALID_PUSH_KEYS', 'مفتاح المتصفح غير صالح.');
  }
  return { endpoint, p256dh, auth };
}
export function registerPush(db: AppDatabase, user: AuthenticatedUser, input: Record<string, unknown>) {
  requirePushUser(user);
  const value = validatePushSubscription(input);
  return inImmediateTransaction(db, () => {
    const previous = db
      .prepare('SELECT id,user_id FROM browser_push_subscriptions WHERE endpoint=?')
      .get(value.endpoint);
    if (previous && previous.user_id !== user.id)
      db.prepare('DELETE FROM browser_push_subscriptions WHERE id=?').run(String(previous.id));
    const existing = db
      .prepare('SELECT id FROM browser_push_subscriptions WHERE endpoint=?')
      .get(value.endpoint);
    if (
      !existing &&
      Number(
        db.prepare('SELECT COUNT(*) n FROM browser_push_subscriptions WHERE user_id=?').get(user.id)!.n,
      ) >= 10
    )
      throw conflict('PUSH_DEVICE_LIMIT', 'وصلت إلى الحد الأقصى للأجهزة المشتركة في الإشعارات.');
    const id = existing ? String(existing.id) : randomUUID();
    db.prepare(
      `INSERT INTO browser_push_subscriptions(id,endpoint,p256dh,auth,user_id,organization_id,session_token_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET
      p256dh=excluded.p256dh,auth=excluded.auth,session_token_hash=excluded.session_token_hash`,
    ).run(
      id,
      value.endpoint,
      value.p256dh,
      value.auth,
      user.id,
      user.organizationId,
      user.sessionTokenHash,
      nowIso(),
    );
    return { id, enabled: true };
  });
}
export function removePush(db: AppDatabase, user: AuthenticatedUser, endpoint: unknown) {
  db.prepare(
    'DELETE FROM browser_push_subscriptions WHERE endpoint=? AND user_id=? AND organization_id=?',
  ).run(String(endpoint ?? ''), user.id, user.organizationId);
  return { enabled: false };
}
export function queuePushTest(db: AppDatabase, user: AuthenticatedUser, endpoint: unknown) {
  requirePushUser(user);
  return inImmediateTransaction(db, () => {
    const row = db
      .prepare(
        'SELECT id,last_test_at FROM browser_push_subscriptions WHERE endpoint=? AND user_id=? AND organization_id=?',
      )
      .get(String(endpoint ?? ''), user.id, user.organizationId);
    if (!row) throw badRequest('PUSH_NOT_SUBSCRIBED', 'فعّل إشعارات المتصفح أولًا.');
    if (Date.now() - Number(row.last_test_at) < 60000)
      throw conflict('PUSH_TEST_LIMIT', 'انتظر دقيقة قبل إعادة التجربة.');
    db.prepare('UPDATE browser_push_subscriptions SET last_test_at=? WHERE id=?').run(
      Date.now(),
      String(row.id),
    );
    db.prepare('INSERT INTO browser_push_outbox(subscription_id) VALUES(?)').run(String(row.id));
    return { queued: true };
  });
}

export type PushTransport = (
  subscription: webPush.PushSubscription,
  payload: string,
  options: webPush.RequestOptions,
) => Promise<unknown>;
export function createPushDispatcher(
  db: AppDatabase,
  config: ServerConfig,
  send: PushTransport = webPush.sendNotification,
) {
  const settings = pushSettings(config);
  let running = false,
    stopped = false;
  async function drain() {
    if (!settings || running || stopped) return;
    running = true;
    try {
      // Keep a device subscription across browser sessions. Delivery is revoked
      // only when the user disables it, the account loses access, or the endpoint expires.
      db.prepare(
        `DELETE FROM browser_push_subscriptions WHERE id NOT IN (
        SELECT p.id FROM browser_push_subscriptions p
        JOIN users u ON u.id=p.user_id AND u.organization_id=p.organization_id
        JOIN organizations o ON o.id=u.organization_id JOIN branches b ON b.id=u.home_branch_id AND b.organization_id=o.id
        WHERE u.is_active=1 AND u.must_change_password=0 AND o.status='active' AND b.is_active=1
          AND (u.role='admin' OR EXISTS(SELECT 1 FROM user_permissions x WHERE x.user_id=u.id AND x.permission='collections.read' AND x.allowed=1))
      )`,
      ).run();
      db.prepare('DELETE FROM browser_push_outbox WHERE created_at<? OR attempts>=6').run(
        Date.now() - 86400000,
      );
      const rows = db
        .prepare(
          `SELECT q.*,p.endpoint,p.p256dh,p.auth,n.action,n.details_json,u.display_name actor_name,c.mode payment_mode,
          (SELECT COUNT(*) FROM notifications unread WHERE unread.organization_id=p.organization_id AND unread.recipient_user_id=p.user_id AND unread.read_at IS NULL) unread_count
          FROM browser_push_outbox q
        JOIN browser_push_subscriptions p ON p.id=q.subscription_id
        LEFT JOIN notifications n ON n.id=q.notification_id AND n.recipient_user_id=p.user_id AND n.organization_id=p.organization_id
        LEFT JOIN users u ON u.id=n.actor_user_id AND u.organization_id=p.organization_id
        LEFT JOIN collection_submissions c ON n.action='collection.submit' AND c.id=n.entity_id
        WHERE (q.notification_id IS NULL OR n.id IS NOT NULL) AND q.next_attempt_at<=? ORDER BY q.id LIMIT 10`,
        )
        .all(Date.now());
      await Promise.all(
        rows.map(async (row) => {
          let details: Record<string, unknown> = {};
          try { details = JSON.parse(String(row.details_json ?? '{}')) ?? {}; } catch { /* Use action label. */ }
          const payload = JSON.stringify({
            title: 'VIB Abdo Company',
            body: row.notification_id
              ? browserPushMessage(String(row.action), String(row.actor_name ?? 'النظام'), String(row.payment_mode ?? details.paymentMode ?? details.mode ?? ''))
              : 'وصل إشعار التجربة بنجاح.',
            tag: 'abdo-' + row.id,
            url: '/erp',
            badgeCount: Math.max(0, Number(row.unread_count ?? 0)),
          });
          try {
            await send(
              {
                endpoint: String(row.endpoint),
                keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
              },
              payload,
              { vapidDetails: settings, TTL: 3600, urgency: 'normal', timeout: 5000 },
            );
            if (!stopped) db.prepare('DELETE FROM browser_push_outbox WHERE id=?').run(row.id);
          } catch (error) {
            if (stopped) return;
            const status = (error as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410)
              db.prepare('DELETE FROM browser_push_subscriptions WHERE id=?').run(row.subscription_id);
            else
              db.prepare(
                'UPDATE browser_push_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=?',
              ).run(Date.now() + Math.min(3600000, 5000 * 2 ** Number(row.attempts)), row.id);
          }
        }),
      );
    } finally {
      running = false;
    }
  }
  const timer = settings
    ? setInterval(() => {
        void drain().catch(() => console.error('Browser push dispatch failed; retry scheduled.'));
      }, 3000)
    : null;
  timer?.unref();
  return {
    drain,
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
