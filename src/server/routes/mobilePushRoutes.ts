import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { registerMobileDevice } from '../domain/mobilePush.ts';
import { readJson, sendJson } from '../http/io.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

export async function routeMobilePush(
  db: AppDatabase,
  user: AuthenticatedUser,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  if (request.method !== 'POST' || url.pathname !== '/api/mobile-push/devices') return false;
  const body = await readJson(request);
  sendJson(response, 200, { ok: true, data: registerMobileDevice(db, user, body) });
  return true;
}
