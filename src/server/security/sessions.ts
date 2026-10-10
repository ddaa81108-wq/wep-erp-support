import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { unauthorized } from '../http/errors.ts';

export const SESSION_COOKIE = 'abdo_session';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export type AuthenticatedUser = {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'employee';
  isOwner?: boolean;
  organizationId: string;
  homeBranchId: string;
  mustChangePassword: boolean;
  permissions: Set<string>;
  sessionTokenHash: string;
  csrfHash: string;
};

export function createSession(
  database: AppDatabase,
  userId: string,
  clientApiVersion: string,
  sessionHours: number,
  metadata: { remoteAddress?: string; userAgent?: string } = {},
) {
  const eligible = database.prepare(`
    SELECT 1 FROM users u
    JOIN organizations o ON o.id = u.organization_id
    JOIN branches b ON b.id = u.home_branch_id AND b.organization_id = o.id
    WHERE u.id = ? AND u.is_active = 1 AND o.status = 'active' AND b.is_active = 1
  `).get(userId);
  if (!eligible) throw unauthorized();
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionHours * 3_600_000).toISOString();
  database.prepare(`
    INSERT INTO sessions(
      token_hash, user_id, csrf_hash, client_api_version,
      created_at, last_seen_at, expires_at, remote_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sha256(token), userId, sha256(csrfToken), clientApiVersion,
    createdAt, createdAt, expiresAt,
    metadata.remoteAddress?.slice(0, 120) ?? '',
    metadata.userAgent?.slice(0, 500) ?? '',
  );
  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(
  response: ServerResponse,
  token: string,
  expiresAt: string,
  secure: boolean,
) {
  const securePart = secure ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${securePart}`,
  );
}

export function clearSessionCookie(response: ServerResponse, secure: boolean) {
  const securePart = secure ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${securePart}`,
  );
}

function cookieValue(request: IncomingMessage, name: string) {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function authenticate(
  database: AppDatabase,
  request: IncomingMessage,
): AuthenticatedUser | null {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = database.prepare(`
    SELECT
      s.token_hash, s.csrf_hash, s.expires_at, s.last_seen_at,
      u.id, u.username, u.display_name, u.role, u.is_owner, u.is_active,
      u.organization_id, u.home_branch_id, u.must_change_password,
      o.status AS organization_status, b.is_active AS branch_is_active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN organizations o ON o.id = u.organization_id
    JOIN branches b ON b.id = u.home_branch_id AND b.organization_id = o.id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
  `).get(tokenHash) as Record<string, unknown> | undefined;
  if (!row || Number(row.is_active) !== 1 || String(row.organization_status) !== 'active'
    || Number(row.branch_is_active) !== 1 || String(row.expires_at) <= nowIso()) {
    return null;
  }
  const permissions = new Set(
    database.prepare(
      'SELECT permission FROM user_permissions WHERE user_id = ? AND allowed = 1',
    ).all(String(row.id)).map((permission) => String(permission.permission)),
  );
  const lastSeenAt = Date.parse(String(row.last_seen_at));
  if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= 5 * 60_000) {
    database.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(nowIso(), tokenHash);
  }
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: String(row.role) as AuthenticatedUser['role'],
    isOwner: Number(row.is_owner) === 1,
    organizationId: String(row.organization_id),
    homeBranchId: String(row.home_branch_id),
    mustChangePassword: Number(row.must_change_password) === 1,
    permissions,
    sessionTokenHash: tokenHash,
    csrfHash: String(row.csrf_hash),
  };
}

export function csrfIsValid(request: IncomingMessage, user: AuthenticatedUser) {
  const token = request.headers['x-csrf-token'];
  if (typeof token !== 'string') return false;
  const provided = Buffer.from(sha256(token), 'hex');
  const expected = Buffer.from(user.csrfHash, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function rotateCsrfToken(database: AppDatabase, user: AuthenticatedUser) {
  const csrfToken = randomBytes(24).toString('base64url');
  const result = database.prepare(`
    UPDATE sessions SET csrf_hash = ?, last_seen_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(sha256(csrfToken), nowIso(), user.sessionTokenHash);
  if (Number(result.changes) !== 1) return null;
  user.csrfHash = sha256(csrfToken);
  return csrfToken;
}

export function revokeSession(database: AppDatabase, user: AuthenticatedUser) {
  database.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
  ).run(nowIso(), user.sessionTokenHash);
}
