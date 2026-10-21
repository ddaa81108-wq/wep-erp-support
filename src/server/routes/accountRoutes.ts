import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerConfig } from '../config.ts';
import { API_VERSION, SCHEMA_VERSION } from '../config.ts';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { DEFAULT_BRANCH_ID, DEFAULT_ORGANIZATION_ID } from '../domain/tenancy.ts';
import { getOrganizationSettings } from '../domain/organizationSettings.ts';
import { HttpError, badRequest, conflict, unauthorized } from '../http/errors.ts';
import { newPasswordField, secretField, textField } from '../http/fields.ts';
import { assertSameOrigin, readJson, sendJson } from '../http/io.ts';
import {
  beginGoogleAuth,
  clearGoogleBindingCookie,
  completeGoogleAuth,
  googleAuthConfigured,
  googleBrowserBinding,
  setGoogleBindingCookie,
} from '../modules/accounts/googleAuth.ts';
import {
  loginRateLimited,
  recordLoginFailure,
  reserveLoginCheck,
  remoteAddress,
  setupIsAuthorized,
} from '../security/loginProtection.ts';
import { hashPassword, verifyPassword } from '../security/password.ts';
import { beginMfa, confirmMfa, consumeMfaChallenge, createMfaChallenge, hasMfa, mfaConfigured, verifyMfa } from '../security/mfa.ts';
import { forbidden } from '../http/errors.ts';
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  rotateCsrfToken,
  setSessionCookie,
  type AuthenticatedUser,
} from '../security/sessions.ts';

const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$YWJkby1lcnAtbG9naW4tZHVtbXktc2FsdA$ns0Oz1oJVOqhEJcr5m9xRtZ5ZVJVIifKKjlbm1G0QBDz-_U8XY5B2RXZHy90rGilN-MiW9BSbBpDgeXeayEgw';

type AccountRouteContext = {
  database: AppDatabase;
  config: ServerConfig;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
  correlationId: string;
};

const MFA_COOKIE = 'abdo_mfa';
function challenge(context: AccountRouteContext, userId: string) {
  const token = createMfaChallenge(context.database, userId);
  const previous = context.response.getHeader('Set-Cookie');
  context.response.setHeader('Set-Cookie', [...(previous ? Array.isArray(previous) ? previous.map(String) : [String(previous)] : []),
    `${MFA_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=300${context.config.secureCookie ? '; Secure' : ''}`]);
}
function finishLogin(context: AccountRouteContext, userId: string) {
  const { database, request, response, config } = context;
  const row = database.prepare('SELECT * FROM users WHERE id=?').get(userId)!;
  const session = createSession(database, userId, String(request.headers['x-client-api-version'] ?? API_VERSION), config.sessionHours,
    { remoteAddress: remoteAddress(request), userAgent: String(request.headers['user-agent'] ?? '') });
  setSessionCookie(response, session.token, session.expiresAt, config.secureCookie);
  // Keep both cookies when clearing the short-lived challenge.
  response.setHeader('Set-Cookie', [String(response.getHeader('Set-Cookie')),
    `${MFA_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookie ? '; Secure' : ''}`]);
  const permissions = database.prepare('SELECT permission FROM user_permissions WHERE user_id=? AND allowed=1 ORDER BY permission')
    .all(userId).map(item => String(item.permission));
  sendJson(response, 200, { ok: true, data: { user: { id: userId, username: String(row.username), displayName: String(row.display_name),
    role: String(row.role), isOwner: Number(row.is_owner) === 1, mustChangePassword: Number(row.must_change_password) === 1, permissions },
    csrfToken: session.csrfToken, expiresAt: session.expiresAt, apiVersion: API_VERSION } });
}

async function verifyCurrentPassword(context: AccountRouteContext, user: AuthenticatedUser, input: Record<string, unknown>) {
  const password = secretField(input.password, 'password', 1, 256), address = remoteAddress(context.request);
  if (loginRateLimited(context.database, user.username, address)) throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'محاولات كثيرة. حاول لاحقًا.');
  const release = reserveLoginCheck(context.database, user.username, address);
  if (!release) throw new HttpError(429, 'LOGIN_BUSY', 'أعد المحاولة بعد قليل.');
  try {
    const row = context.database.prepare('SELECT password_hash,password_login_enabled FROM users WHERE id=?').get(user.id)!;
    if (Number(row.password_login_enabled) !== 1 || !await verifyPassword(password, String(row.password_hash))) {
      recordLoginFailure(context.database, user.username, address);
      throw new HttpError(403, 'PASSWORD_VERIFICATION_FAILED', 'تعذر تأكيد كلمة مرور الحساب.');
    }
  } finally { release(); }
}

async function setupAdmin(
  database: AppDatabase,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const username = textField(input.username, 'username', 3, 80).toLocaleLowerCase('en');
  const displayName = textField(input.displayName, 'displayName', 2, 120);
  const password = newPasswordField(input.password, 'password');
  const passwordHash = await hashPassword(password);
  return inImmediateTransaction(database, () => {
    const count = database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    if (Number(count.count) > 0) throw conflict('SETUP_ALREADY_COMPLETED', 'تم إنشاء المدير الأول من قبل.');
    const id = randomUUID();
    const createdAt = nowIso();
    database.prepare(`
      INSERT INTO users(
        id, username, display_name, password_hash, role, organization_id,
        home_branch_id, is_owner, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'admin', ?, ?, 1, ?, ?)
    `).run(
      id, username, displayName, passwordHash, DEFAULT_ORGANIZATION_ID,
      DEFAULT_BRANCH_ID, createdAt, createdAt,
    );
    database.prepare(`
      INSERT INTO audit_log(
        actor_user_id, organization_id, action, entity_type, entity_id,
        correlation_id, outcome, details_json, created_at
      ) VALUES (?, ?, 'system.first_admin.create', 'user', ?, ?, 'success', '{}', ?)
    `).run(id, DEFAULT_ORGANIZATION_ID, id, correlationId, createdAt);
    return { id, username, displayName, role: 'admin', isOwner: true };
  });
}

export async function routePublicAccount(context: AccountRouteContext) {
  const { database, config, request, response, url, method, correlationId } = context;
  if (method === 'POST' && url.pathname === '/api/auth/mfa/verify') {
    assertSameOrigin(request);
    const input = await readJson(request);
    const code = secretField(input.code, 'code', 1, 32).trim();
    const token = (request.headers.cookie ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(`${MFA_COOKIE}=`))?.slice(MFA_COOKIE.length + 1) ?? '';
    const address = remoteAddress(request), identity = `mfa:${token.slice(0, 64)}`;
    if (loginRateLimited(database, identity, address)) throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'محاولات كثيرة. حاول لاحقًا.');
    const userId = /^[\w-]{43}$/.test(token) ? consumeMfaChallenge(database, token, code) : null;
    if (!userId) {
      recordLoginFailure(database, identity, address);
      throw new HttpError(401, 'MFA_INVALID', 'الرمز غير صحيح أو مستخدم أو انتهت محاولة الدخول.');
    }
    finishLogin(context, userId);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/setup/status') {
    const row = database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    sendJson(response, 200, { ok: true, data: { setupRequired: Number(row.count) === 0 } });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/setup/admin') {
    assertSameOrigin(request);
    if (!setupIsAuthorized(request, config)) {
      throw new HttpError(403, 'SETUP_NOT_AUTHORIZED', 'إنشاء المدير الأول مسموح من الجهاز الرئيسي فقط.');
    }
    const user = await setupAdmin(database, await readJson(request), correlationId);
    sendJson(response, 201, { ok: true, data: { user } });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/auth/google/status') {
    sendJson(response, 200, {
      ok: true,
      data: { configured: googleAuthConfigured(config), registrationRequiresApproval: true },
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/auth/google/start') {
    const mode = url.searchParams.get('mode');
    if (mode !== 'login' && mode !== 'register') {
      throw badRequest('INVALID_GOOGLE_MODE', 'نوع دخول Google غير صالح.');
    }
    const started = beginGoogleAuth(database, config, mode, remoteAddress(request));
    setGoogleBindingCookie(response, started.browserBinding, config.secureCookie);
    response.writeHead(302, { Location: started.authorizationUrl, 'Cache-Control': 'no-store' });
    response.end();
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/auth/google/callback') {
    const browserBinding = googleBrowserBinding(request);
    clearGoogleBindingCookie(response, config.secureCookie);
    if (url.searchParams.get('error')) {
      response.writeHead(302, { Location: '/?google=cancelled', 'Cache-Control': 'no-store' });
      response.end();
      return true;
    }
    const result = await completeGoogleAuth(
      database, config, url.searchParams.get('state') ?? '',
      url.searchParams.get('code') ?? '', browserBinding,
    );
    if (result.status === 'approved' && result.userId) {
      if (hasMfa(database, result.userId)) {
        challenge(context, result.userId);
        response.writeHead(302, { Location: '/erp?google=mfa', 'Cache-Control': 'no-store' });
        response.end(); return true;
      }
      const session = createSession(
        database, result.userId,
        String(request.headers['x-client-api-version'] ?? API_VERSION), config.sessionHours,
        { remoteAddress: remoteAddress(request), userAgent: String(request.headers['user-agent'] ?? '') },
      );
      setSessionCookie(response, session.token, session.expiresAt, config.secureCookie);
    }
    response.writeHead(302, { Location: `/?google=${result.status}`, 'Cache-Control': 'no-store' });
    response.end();
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    assertSameOrigin(request);
    const input = await readJson(request);
    const username = textField(input.username, 'username', 3, 80).toLocaleLowerCase('en');
    const password = secretField(input.password, 'password', 1, 256);
    const address = remoteAddress(request);
    if (loginRateLimited(database, username, address)) {
      throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'محاولات الدخول كثيرة. حاول بعد عدة دقائق.');
    }
    const row = database.prepare(`
      SELECT u.id, u.username, u.display_name, u.password_hash, u.role, u.is_owner, u.is_active,
        u.must_change_password, u.password_login_enabled,
        o.status AS organization_status, b.is_active AS branch_is_active
      FROM users u
      JOIN organizations o ON o.id = u.organization_id
      JOIN branches b ON b.id = u.home_branch_id AND b.organization_id = o.id
      WHERE u.username = ?
    `).get(username) as Record<string, unknown> | undefined;
    const release = reserveLoginCheck(database, username, address);
    if (!release) {
      response.setHeader('Retry-After', '2');
      throw new HttpError(429, 'LOGIN_BUSY', 'محاولات دخول متزامنة كثيرة. أعد المحاولة بعد ثوانٍ.');
    }
    let passwordValid: boolean;
    try {
      passwordValid = await verifyPassword(password, row ? String(row.password_hash) : DUMMY_PASSWORD_HASH);
    } finally {
      release();
    }
    if (!row || Number(row.is_active) !== 1 || Number(row.password_login_enabled) !== 1
      || String(row.organization_status) !== 'active' || Number(row.branch_is_active) !== 1
      || !passwordValid) {
      recordLoginFailure(database, username, address);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    }
    database.prepare('DELETE FROM login_failures WHERE username = ?').run(username);
    if (hasMfa(database, String(row.id))) {
      challenge(context, String(row.id));
      throw new HttpError(401, 'MFA_REQUIRED', 'أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد.');
    }
    finishLogin(context, String(row.id));
    return true;
  }
  return false;
}

export async function routeAuthenticatedAccount(
  context: AccountRouteContext & { user: AuthenticatedUser },
) {
  const { database, config, request, response, url, method, correlationId, user } = context;
  if (url.pathname.startsWith('/api/auth/mfa/')) {
    if (user.mustChangePassword) throw forbidden('password.change-required');
    if (method === 'GET' && url.pathname === '/api/auth/mfa/status') {
      sendJson(response, 200, { ok: true, data: { configured: mfaConfigured(), enabled: hasMfa(database, user.id) } }); return true;
    }
    if (method === 'POST' && ['/api/auth/mfa/begin', '/api/auth/mfa/confirm', '/api/auth/mfa/disable'].includes(url.pathname)) {
      if (user.role !== 'admin' && url.pathname !== '/api/auth/mfa/disable') throw forbidden('mfa.admin');
      const input = await readJson(request), address = remoteAddress(request);
      if (loginRateLimited(database, user.username, address)) throw new HttpError(429, 'LOGIN_RATE_LIMITED', 'محاولات كثيرة. حاول لاحقًا.');
      if (url.pathname.endsWith('/begin')) {
        await verifyCurrentPassword(context, user, input);
        sendJson(response, 200, { ok: true, data: beginMfa(database, user.id, user.username, user.sessionTokenHash) }); return true;
      }
      const code = secretField(input.code, 'code', 1, 32).trim();
      if (url.pathname.endsWith('/confirm')) {
        const codes = confirmMfa(database, user.id, user.sessionTokenHash, code);
        if (!codes) { recordLoginFailure(database, user.username, address); throw new HttpError(400, 'MFA_INVALID', 'الرمز غير صحيح أو انتهى وقت الإعداد.'); }
        mfaAudit('user.mfa.enable');
        sendJson(response, 200, { ok: true, data: { recoveryCodes: codes } }); return true;
      }
      await verifyCurrentPassword(context, user, input);
      if (!verifyMfa(database, user.id, code)) { recordLoginFailure(database, user.username, address); throw new HttpError(403, 'MFA_INVALID', 'تعذر تأكيد رمز المصادقة.'); }
      inImmediateTransaction(database, () => {
        database.prepare('DELETE FROM user_mfa WHERE user_id=?').run(user.id);
        database.prepare('DELETE FROM mfa_challenges WHERE user_id=?').run(user.id);
        database.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL').run(nowIso(), user.id, user.sessionTokenHash);
        mfaAudit('user.mfa.disable');
      });
      sendJson(response, 200, { ok: true, data: { disabled: true } }); return true;
    }
  }
  function mfaAudit(action: string) {
    database.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,correlation_id,outcome,details_json,created_at)
      VALUES(?,?,?,'user',?,?,'success','{}',?)`).run(user.id, user.organizationId, action, user.id, correlationId, nowIso());
  }
  if (method === 'GET' && url.pathname === '/api/organization-branding') {
    const { systemName } = getOrganizationSettings(database, user.organizationId);
    sendJson(response, 200, { ok: true, data: { systemName } });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    revokeSession(database, user);
    clearSessionCookie(response, config.secureCookie);
    sendJson(response, 200, { ok: true, data: { loggedOut: true } });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/me') {
    sendJson(response, 200, {
      ok: true,
      data: {
        user: {
          id: user.id, username: user.username, displayName: user.displayName, role: user.role,
          isOwner: user.isOwner === true,
          mustChangePassword: user.mustChangePassword, permissions: [...user.permissions].sort(),
        },
        apiVersion: API_VERSION,
        schemaVersion: SCHEMA_VERSION,
      },
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/auth/csrf') {
    const csrfToken = rotateCsrfToken(database, user);
    if (!csrfToken) throw unauthorized();
    sendJson(response, 200, { ok: true, data: { csrfToken } });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/auth/change-password') {
    const input = await readJson(request);
    const currentPassword = secretField(input.currentPassword, 'currentPassword', 1, 256);
    const newPassword = newPasswordField(input.newPassword, 'newPassword');
    const row = database.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as {
      password_hash: string;
    };
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw new HttpError(401, 'INVALID_CURRENT_PASSWORD', 'كلمة المرور الحالية غير صحيحة.');
    }
    if (currentPassword === newPassword) {
      throw badRequest('PASSWORD_UNCHANGED', 'اختر كلمة مرور جديدة مختلفة عن المؤقتة.');
    }
    const changedAt = nowIso();
    const newPasswordHash = await hashPassword(newPassword);
    inImmediateTransaction(database, () => {
      database.prepare(`
        UPDATE users SET password_hash = ?, must_change_password = 0,
          version = version + 1, updated_at = ? WHERE id = ?
      `).run(newPasswordHash, changedAt, user.id);
      database.prepare(`
        UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL
      `).run(changedAt, user.id, user.sessionTokenHash);
      database.prepare(`
        INSERT INTO audit_log(actor_user_id, organization_id, action, entity_type, entity_id, correlation_id, outcome, details_json, created_at)
        VALUES (?, ?, 'user.password.change', 'user', ?, ?, 'success', '{}', ?)
      `).run(user.id, user.organizationId, user.id, correlationId, changedAt);
    });
    sendJson(response, 200, { ok: true, data: { changed: true } });
    return true;
  }
  return false;
}
