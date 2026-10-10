import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { ServerConfig } from '../../config.ts';
import type { AppDatabase } from '../../db/database.ts';
import { inImmediateTransaction, nowIso } from '../../db/database.ts';
import { HttpError, badRequest, conflict } from '../../http/errors.ts';
import { DEFAULT_ORGANIZATION_ID } from '../../domain/tenancy.ts';

const OAUTH_BINDING_COOKIE = 'abdo_oauth_binding';
const stateHash = (value: string) => createHash('sha256').update(value).digest('hex');
const codeChallenge = (value: string) => createHash('sha256').update(value).digest('base64url');

function hashesMatch(value: string, expectedHash: string) {
  const supplied = Buffer.from(stateHash(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function cookieValue(request: IncomingMessage, name: string) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

export function googleBrowserBinding(request: IncomingMessage) {
  return cookieValue(request, OAUTH_BINDING_COOKIE);
}

export function setGoogleBindingCookie(response: ServerResponse, binding: string, secure: boolean) {
  response.setHeader(
    'Set-Cookie',
    `${OAUTH_BINDING_COOKIE}=${binding}; Path=/api/auth/google/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`,
  );
}

export function clearGoogleBindingCookie(response: ServerResponse, secure: boolean) {
  response.setHeader(
    'Set-Cookie',
    `${OAUTH_BINDING_COOKIE}=; Path=/api/auth/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  );
}

export function googleAuthConfigured(config: ServerConfig) {
  return Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}

function client(config: ServerConfig) {
  if (!googleAuthConfigured(config)) {
    throw conflict('GOOGLE_AUTH_NOT_CONFIGURED', 'الدخول باستخدام Google لم يُربط بالإدارة بعد.');
  }
  return new OAuth2Client(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

export function beginGoogleAuth(
  database: AppDatabase,
  config: ServerConfig,
  mode: 'login' | 'register',
  remoteAddress: string,
) {
  const oauth = client(config);
  const state = randomBytes(32).toString('base64url');
  const browserBinding = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  database.prepare('DELETE FROM oauth_states WHERE expires_at < ? OR consumed_at IS NOT NULL').run(createdAt);
  const address = remoteAddress.slice(0, 64);
  const recent = database.prepare(`
    SELECT COUNT(*) AS count FROM oauth_states
    WHERE remote_address = ? AND consumed_at IS NULL AND expires_at >= ?
  `).get(address, createdAt) as { count: number };
  if (Number(recent.count) >= 20) {
    throw new HttpError(429, 'GOOGLE_AUTH_RATE_LIMITED', 'محاولات الدخول باستخدام Google كثيرة. حاول بعد عدة دقائق.');
  }
  database.prepare(`
    INSERT INTO oauth_states(
      state_hash, mode, created_at, expires_at, remote_address,
      browser_binding_hash, code_verifier, nonce_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stateHash(state), mode, createdAt, expiresAt, address,
    stateHash(browserBinding), codeVerifier, stateHash(nonce),
  );
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: 'online', prompt: 'select_account', state, nonce,
    code_challenge: codeChallenge(codeVerifier), code_challenge_method: CodeChallengeMethod.S256,
    scope: ['openid', 'email', 'profile'], include_granted_scopes: false,
  });
  return { authorizationUrl, browserBinding };
}

export async function completeGoogleAuth(
  database: AppDatabase,
  config: ServerConfig,
  state: string,
  code: string,
  browserBinding: string,
) {
  if (!state || !code) throw badRequest('GOOGLE_CALLBACK_INVALID', 'استجابة Google غير مكتملة.');
  const stateRow = database.prepare(`
    SELECT mode, expires_at, consumed_at, browser_binding_hash, code_verifier, nonce_hash
    FROM oauth_states WHERE state_hash = ?
  `).get(stateHash(state)) as Record<string, unknown> | undefined;
  if (!stateRow || stateRow.consumed_at || String(stateRow.expires_at) <= nowIso()) {
    throw badRequest('GOOGLE_STATE_INVALID', 'انتهت محاولة Google أو لم تعد صالحة. ابدأ من جديد.');
  }
  const expectedBinding = String(stateRow.browser_binding_hash ?? '');
  if (!browserBinding || !expectedBinding || !hashesMatch(browserBinding, expectedBinding)) {
    throw badRequest('GOOGLE_BROWSER_BINDING_INVALID', 'يجب إكمال تسجيل Google من المتصفح الذي بدأ العملية.');
  }
  const codeVerifier = String(stateRow.code_verifier ?? '');
  if (!codeVerifier) throw badRequest('GOOGLE_STATE_INVALID', 'انتهت محاولة Google أو لم تعد صالحة. ابدأ من جديد.');

  const oauth = client(config);
  const { tokens } = await oauth.getToken({ code, codeVerifier });
  if (!tokens.id_token) throw badRequest('GOOGLE_ID_TOKEN_MISSING', 'لم يُرجع Google هوية قابلة للتحقق.');
  const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
  const payload = ticket.getPayload();
  const expectedNonce = String(stateRow.nonce_hash ?? '');
  if (!payload?.nonce || !expectedNonce || !hashesMatch(payload.nonce, expectedNonce)) {
    throw badRequest('GOOGLE_NONCE_INVALID', 'تعذر التحقق من جلسة Google. ابدأ من جديد.');
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw badRequest('GOOGLE_EMAIL_UNVERIFIED', 'يلزم بريد Google موثّق لإنشاء الحساب.');
  }
  const subject = payload.sub;
  const email = payload.email.toLocaleLowerCase('en');
  const displayName = (payload.name || email.split('@')[0]).trim().slice(0, 120);
  const pictureUrl = payload.picture?.slice(0, 1_000) ?? null;
  const consumedAt = nowIso();
  const consumed = database.prepare(`
    UPDATE oauth_states SET consumed_at = ?, code_verifier = NULL
    WHERE state_hash = ? AND consumed_at IS NULL
  `).run(consumedAt, stateHash(state));
  if (Number(consumed.changes) !== 1) throw conflict('GOOGLE_STATE_USED', 'استُخدمت محاولة Google من قبل.');

  const identity = database.prepare(`
    SELECT u.id, u.is_active, o.status AS organization_status, b.is_active AS branch_is_active
    FROM user_identities i
    JOIN users u ON u.id = i.user_id
    JOIN organizations o ON o.id = u.organization_id
    JOIN branches b ON b.id = u.home_branch_id AND b.organization_id = o.id
    WHERE i.provider = 'google' AND i.provider_subject = ?
  `).get(subject) as Record<string, unknown> | undefined;
  if (identity) {
    return Number(identity.is_active) === 1 && String(identity.organization_status) === 'active'
      && Number(identity.branch_is_active) === 1
      ? { status: 'approved' as const, userId: String(identity.id) }
      : { status: 'disabled' as const, userId: null };
  }

  return inImmediateTransaction(database, () => {
    const registrationOrganizationId = config.googleRegistrationOrganizationId ?? DEFAULT_ORGANIZATION_ID;
    const organization = database.prepare(`
      SELECT id FROM organizations WHERE id = ? AND status = 'active'
    `).get(registrationOrganizationId);
    if (!organization) {
      throw conflict(
        'GOOGLE_REGISTRATION_ORGANIZATION_UNAVAILABLE',
        'مؤسسة استقبال طلبات Google غير متاحة حاليًا.',
      );
    }
    const existing = database.prepare(`
      SELECT * FROM account_requests
      WHERE organization_id = ? AND provider = 'google' AND provider_subject = ?
    `).get(registrationOrganizationId, subject) as Record<string, unknown> | undefined;
    if (existing) {
      if (String(existing.status) === 'rejected') return { status: 'rejected' as const, userId: null };
      database.prepare(`
        UPDATE account_requests SET email = ?, display_name = ?, picture_url = ?
        WHERE id = ? AND status = 'pending'
      `).run(email, displayName, pictureUrl, String(existing.id));
      return { status: 'pending' as const, userId: null };
    }
    database.prepare(`
      INSERT INTO account_requests(
        id, organization_id, provider, provider_subject, email, display_name, picture_url, status, requested_at
      ) VALUES (?, ?, 'google', ?, ?, ?, ?, 'pending', ?)
    `).run(randomUUID(), registrationOrganizationId, subject, email, displayName, pictureUrl, consumedAt);
    return { status: 'pending' as const, userId: null };
  });
}
