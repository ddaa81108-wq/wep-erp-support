import type { IncomingMessage } from 'node:http';
import { API_VERSION } from '../config.ts';
import type { AppDatabase } from '../db/database.ts';
import { conflict, forbidden, HttpError, unauthorized } from './errors.ts';
import { assertSameOrigin } from './io.ts';
import { authenticate, csrfIsValid, type AuthenticatedUser } from '../security/sessions.ts';

export function requirePermission(user: AuthenticatedUser, permission: string) {
  if (user.role !== 'admin' && !user.permissions.has(permission)) throw forbidden(permission);
}

export function requireUser(database: AppDatabase, request: IncomingMessage) {
  const user = authenticate(database, request);
  if (!user) throw unauthorized();
  return user;
}

export function requireMutationSafety(request: IncomingMessage, user: AuthenticatedUser) {
  assertSameOrigin(request);
  if (!csrfIsValid(request, user)) {
    throw new HttpError(403, 'CSRF_REJECTED', 'رمز حماية الطلب مفقود أو غير صالح.');
  }
  const clientVersion = request.headers['x-client-api-version'];
  if (clientVersion !== API_VERSION) {
    throw conflict(
      'CLIENT_VERSION_MISMATCH',
      'إصدار الواجهة غير متوافق مع الخادم. احتفظ بالمسودة ثم حدّث الواجهة.',
      { requiredApiVersion: API_VERSION, receivedApiVersion: clientVersion ?? null },
    );
  }
}
