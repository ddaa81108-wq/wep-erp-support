import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import type { ServerConfig } from '../config.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import {
  pushSettings,
  requirePushUser,
  registerPush,
  removePush,
  queuePushTest,
} from '../domain/browserPush.ts';
import { readJson, sendJson } from '../http/io.ts';
import { conflict } from '../http/errors.ts';
export async function routeBrowserPush(
  db: AppDatabase,
  config: ServerConfig,
  user: AuthenticatedUser,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  if (!url.pathname.startsWith('/api/browser-push/')) return false;
  requirePushUser(user);
  const settings = pushSettings(config);
  if (request.method === 'GET' && url.pathname === '/api/browser-push/config') {
    sendJson(response, 200, {
      ok: true,
      data: {
        ready: Boolean(settings),
        publicKey: settings?.publicKey ?? null,
        endpoints: db
          .prepare('SELECT endpoint FROM browser_push_subscriptions WHERE user_id=? AND session_token_hash=?')
          .all(user.id, user.sessionTokenHash)
          .map((row) => String(row.endpoint)),
      },
    });
    return true;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/browser-push/subscription') {
    sendJson(response, 200, { ok: true, data: removePush(db, user, (await readJson(request)).endpoint) });
    return true;
  }
  if (!settings)
    throw conflict('PUSH_NOT_CONFIGURED', 'إشعارات الخلفية تحتاج تجهيز مفتاح الإرسال على الخادم.');
  if (request.method === 'POST' && url.pathname === '/api/browser-push/subscription') {
    sendJson(response, 200, { ok: true, data: registerPush(db, user, await readJson(request)) });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/browser-push/test') {
    sendJson(response, 202, { ok: true, data: queuePushTest(db, user, (await readJson(request)).endpoint) });
    return true;
  }
  return false;
}
