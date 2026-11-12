import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { browserPushMessage } from './browserPushMessage.ts';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { badRequest, conflict } from '../http/errors.ts';

export const fcmChannelId = 'vib_notices_sound_v1';

export type FcmAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type FcmMessage = {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: string;
};

export type FcmSend = (message: FcmMessage, account: FcmAccount) => Promise<void>;

/** Reads the service-account file. Absent file or env means the feature is off. */
export function loadFcmAccount(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): FcmAccount | null {
  const path = env.ABDO_FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!path) return null;
  let text: string;
  try {
    text = read(path);
  } catch {
    return null;
  }
  return parseFcmAccount(text);
}

export function parseFcmAccount(text: string): FcmAccount | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const projectId = String(parsed.project_id ?? '');
    const clientEmail = String(parsed.client_email ?? '');
    const privateKey = String(parsed.private_key ?? '');
    if (!projectId || !clientEmail || !privateKey.includes('BEGIN PRIVATE KEY')) return null;
    return { projectId, clientEmail, privateKey };
  } catch {
    return null;
  }
}

const tokenPattern = /^[A-Za-z0-9_:\-.]+$/;

export function validateDeviceToken(input: Record<string, unknown>) {
  const token = String(input.token ?? '').trim();
  const platform = String(input.platform ?? '');
  if (platform !== 'android') {
    throw badRequest('INVALID_PUSH_PLATFORM', 'منصة الجهاز غير مدعومة.');
  }
  if (token.length < 32 || token.length > 4096 || !tokenPattern.test(token)) {
    throw badRequest('INVALID_PUSH_TOKEN', 'رمز الجهاز غير صالح.');
  }
  return { token, platform, unregister: input.unregister === true };
}

export function registerMobileDevice(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  const value = validateDeviceToken(input);
  if (value.unregister) return removeMobileDevice(db, user, value.token);
  return inImmediateTransaction(db, () => {
    const previous = db
      .prepare('SELECT id, user_id FROM mobile_push_devices WHERE token=?')
      .get(value.token) as { id: string; user_id: string } | undefined;
    if (previous && previous.user_id !== user.id) {
      db.prepare('DELETE FROM mobile_push_devices WHERE id=?').run(previous.id);
    }
    const existing = db.prepare('SELECT id FROM mobile_push_devices WHERE token=?').get(value.token) as
      { id: string } | undefined;
    if (
      !existing &&
      Number(db.prepare('SELECT COUNT(*) n FROM mobile_push_devices WHERE user_id=?').get(user.id)!.n) >= 8
    ) {
      throw conflict('PUSH_DEVICE_LIMIT', 'وصلت إلى الحد الأقصى لأجهزة الإشعار.');
    }
    const id = existing?.id ?? randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO mobile_push_devices(id, token, user_id, organization_id, platform, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(token) DO UPDATE SET
         user_id=excluded.user_id,
         organization_id=excluded.organization_id,
         platform=excluded.platform,
         updated_at=excluded.updated_at`,
    ).run(id, value.token, user.id, user.organizationId, value.platform, now, now);
    return { registered: true };
  });
}

export function removeMobileDevice(db: AppDatabase, user: AuthenticatedUser, token: string) {
  db.prepare('DELETE FROM mobile_push_devices WHERE token=? AND user_id=? AND organization_id=?').run(
    token,
    user.id,
    user.organizationId,
  );
  return { registered: false };
}

export class FcmRequestError extends Error {
  status: number;
  errorCode: string;

  constructor(status: number, errorCode: string) {
    super('FCM request failed');
    this.status = status;
    this.errorCode = errorCode;
  }
}

export function fcmAccessToken(account: FcmAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(account.privateKey).toString('base64url');
  return `${header}.${claim}.${signature}`;
}

/**
 * Who may receive a phone push. This is not the in-app recipient list.
 *
 * In-app rows still go to every other active admin for any successful audit
 * action, including an action by an admin, and a collections assignment is
 * also written to the assignee. Payroll rows are written to that employee too.
 * None of those inserts are changed here.
 *
 * Push is narrower: every active admin receives an employee’s transaction,
 * and an employee receives one only for `collection.assign` when that
 * employee has `collections.read`.
 */
export function mobilePushAllowed(input: {
  recipientRole: string | null;
  actorRole: string | null;
  action: string;
  collectionsRead: boolean;
}) {
  if (input.recipientRole === 'admin') return input.actorRole === 'employee';
  if (input.recipientRole === 'employee') {
    return input.collectionsRead && input.action === 'collection.assign';
  }
  return false;
}

const hiddenDetailKey = /password|token|secret|hash|csrf/i;

/** The shade text. The in-app row already stores these details; the push repeats them. */
export function mobilePushBody(action: string, actorName: string, details: Record<string, unknown>) {
  const head = browserPushMessage(
    action,
    actorName,
    String(details.paymentMode ?? details.mode ?? ''),
  );
  const lines = Object.entries(details)
    .filter(
      ([key, value]) =>
        key !== 'suppressNotification' &&
        !hiddenDetailKey.test(key) &&
        value !== null &&
        value !== undefined &&
        value !== '',
    )
    .map(([key, value]) => {
      const text = typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
      return `${key}: ${text}`;
    });
  const body = lines.length ? `${head}\n${lines.join('\n')}` : head;
  return body.slice(0, 900);
}

export function fcmMessageBody(message: FcmMessage) {
  return {
    message: {
      token: message.token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: message.channelId,
          sound: 'default',
        },
      },
    },
  };
}

type OutboxRow = {
  id: number;
  device_id: string;
  token: string;
  attempts: number;
  notification_id: number;
  action: string;
  actor_name: string | null;
  actor_role: string | null;
  recipient_role: string | null;
  collections_read: number;
  payment_mode: string | null;
  details_json: string | null;
  recipient_user_id: string;
};

export function createMobilePushDispatcher(
  db: AppDatabase,
  account: FcmAccount | null,
  send: FcmSend = defaultFcmSend,
) {
  let running = false;
  let stopped = false;
  async function drain() {
    if (!account || running || stopped) return;
    running = true;
    try {
      db.prepare('DELETE FROM mobile_push_outbox WHERE created_at<? OR attempts>=6').run(
        Date.now() - 86400000,
      );
      const rows = db
        .prepare(
          `SELECT q.id, q.device_id, q.attempts, q.notification_id, d.token,
                  n.action, n.details_json, n.recipient_user_id,
                  u.display_name actor_name, u.role actor_role, uowner.role recipient_role,
                  EXISTS(SELECT 1 FROM user_permissions p
                    WHERE p.user_id=uowner.id AND p.permission='collections.read' AND p.allowed=1) collections_read,
                  c.mode payment_mode
             FROM mobile_push_outbox q
             JOIN mobile_push_devices d ON d.id=q.device_id
             JOIN notifications n ON n.id=q.notification_id
               AND n.recipient_user_id=d.user_id AND n.organization_id=d.organization_id
             JOIN users uowner ON uowner.id=d.user_id AND uowner.is_active=1
             LEFT JOIN users u ON u.id=n.actor_user_id
             LEFT JOIN collection_submissions c ON n.action='collection.submit' AND c.id=n.entity_id
            WHERE q.next_attempt_at<=?
            ORDER BY q.id LIMIT 10`,
        )
        .all(Date.now()) as OutboxRow[];
      for (const row of rows) {
        if (stopped) return;
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(String(row.details_json ?? '{}')) ?? {};
        } catch {
          details = {};
        }
        if (
          !mobilePushAllowed({
            recipientRole: row.recipient_role,
            actorRole: row.actor_role,
            action: String(row.action),
            collectionsRead: Number(row.collections_read) === 1,
          })
        ) {
          db.prepare('DELETE FROM mobile_push_outbox WHERE id=?').run(row.id);
          continue;
        }
        if (row.payment_mode && details.paymentMode == null && details.mode == null) {
          details.paymentMode = row.payment_mode;
        }
        const message: FcmMessage = {
          token: String(row.token),
          title: 'VIB',
          body: mobilePushBody(String(row.action), String(row.actor_name ?? 'النظام'), details),
          channelId: fcmChannelId,
          data: {
            notificationId: String(row.notification_id),
            recipientUserId: String(row.recipient_user_id),
            operationType: String(row.action),
          },
        };
        try {
          await send(message, account);
          if (!stopped) db.prepare('DELETE FROM mobile_push_outbox WHERE id=?').run(row.id);
        } catch (error) {
          if (stopped) return;
          const coded = error as { status?: number; errorCode?: string };
          if (coded.status === 404 || coded.errorCode === 'UNREGISTERED') {
            db.prepare('DELETE FROM mobile_push_devices WHERE id=?').run(row.device_id);
          } else {
            db.prepare('UPDATE mobile_push_outbox SET attempts=attempts+1, next_attempt_at=? WHERE id=?').run(
              Date.now() + Math.min(3600000, 5000 * 2 ** Number(row.attempts)),
              row.id,
            );
          }
        }
      }
    } finally {
      running = false;
    }
  }
  const timer = account
    ? setInterval(() => {
        void drain().catch(() => undefined);
      }, 3000)
    : null;
  timer?.unref();
  return {
    drain,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

async function defaultFcmSend(message: FcmMessage, account: FcmAccount) {
  const jwt = fcmAccessToken(account);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenResponse.ok) throw new FcmRequestError(tokenResponse.status, 'AUTH');
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  const access = tokenBody.access_token;
  if (!access) throw new FcmRequestError(tokenResponse.status, 'AUTH');
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(fcmMessageBody(message)),
    },
  );
  if (response.ok) return;
  let errorCode = '';
  try {
    const body = (await response.json()) as {
      error?: { details?: Array<{ errorCode?: string }> };
    };
    errorCode = body.error?.details?.find((item) => item.errorCode)?.errorCode ?? '';
  } catch {
    // A non-JSON error body still deletes the token when the status says so.
  }
  throw new FcmRequestError(response.status, errorCode);
}
