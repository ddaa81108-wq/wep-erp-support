import type { IncomingMessage } from 'node:http';
import { backupStatus, installedDatabase } from './backupStatus.ts';
import { customerBalance } from './customerAccountRepository.ts';
import { restoreStatus } from './emergencyBackup.ts';
import { SCHEMA_VERSION, UI_VERSION } from '../config.ts';
import type { AppDatabase } from '../db/database.ts';
import { databaseHealth, nowIso } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

const deviceLabel = (agent: unknown) => {
  const value = String(agent ?? '');
  if (/Android/i.test(value)) return 'هاتف Android';
  if (/iPhone|iPad/i.test(value)) return 'جهاز Apple';
  if (/Windows/i.test(value)) return 'كمبيوتر Windows';
  return value ? 'متصفح آخر' : 'جهاز غير معروف';
};

export function operationsSnapshot(database: AppDatabase, actor: AuthenticatedUser, onlineOnly = false) {
  const health = databaseHealth(database);
  const scalar = (sql: string) => Number((database.prepare(sql).get(actor.organizationId) as { count: number }).count);
  const activeSessions = Number((database.prepare(`SELECT COUNT(*) AS count FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE u.organization_id=? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .get(actor.organizationId, nowIso()) as { count: number }).count);
  const accounts = database.prepare(`SELECT c.current_balance_units, cy.id AS cycle_id
    FROM customers c JOIN customer_cycles cy ON cy.customer_id=c.id AND cy.status='active'
    WHERE c.organization_id=? AND c.deleted_at IS NULL AND c.system_link_key IS NULL`).all(actor.organizationId);
  const financialMismatches = accounts.filter(row => customerBalance(database, String(row.cycle_id)) !== Number(row.current_balance_units)).length;
  return {
    integrity: health.integrity,
    schemaVersion: String(health.schemaVersion),
    expectedSchemaVersion: SCHEMA_VERSION,
    uiVersion: UI_VERSION,
    activeUsers: scalar('SELECT COUNT(*) AS count FROM users WHERE organization_id = ? AND is_active = 1'),
    activeSessions,
    technicalErrors: scalar(`SELECT COUNT(*) AS count FROM technical_events
      WHERE organization_id=? AND severity='error'`),
    financialMismatches,
    backupPolicy: 'unverified',
    backupSchedule: installedDatabase(database) ? backupStatus() : null,
    restoreStatus: actor.isOwner && installedDatabase(database) ? restoreStatus() : null,
    restoreDrillStatus: 'unverified',
    onlineOnly,
    checkedAt: nowIso(),
  };
}

export function listOrganizationSessions(database: AppDatabase, actor: AuthenticatedUser) {
  const rows = database.prepare(`
    SELECT s.token_hash, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
      s.remote_address, s.user_agent, u.id AS user_id, u.display_name, u.username, u.role
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE u.organization_id=? AND s.expires_at > datetime('now','-1 day')
    ORDER BY s.revoked_at IS NULL DESC, s.last_seen_at DESC LIMIT 250
  `).all(actor.organizationId) as Record<string, unknown>[];
  return { items: rows.map((row) => ({
    id: String(row.token_hash),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    username: String(row.username),
    role: String(row.role),
    device: deviceLabel(row.user_agent),
    remoteAddress: String(row.remote_address || 'غير متاح'),
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
    expiresAt: String(row.expires_at),
    active: row.revoked_at === null && String(row.expires_at) > nowIso(),
    current: String(row.token_hash) === actor.sessionTokenHash,
  })) };
}

export function revokeOrganizationSession(
  database: AppDatabase, actor: AuthenticatedUser, sessionId: string, correlationId: string,
) {
  const target = database.prepare(`SELECT s.token_hash,u.id AS user_id FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.organization_id=?`)
    .get(sessionId, actor.organizationId) as Record<string, unknown> | undefined;
  if (!target) throw notFound('session');
  const at = nowIso();
  database.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(at, sessionId);
  database.prepare(`INSERT INTO audit_log(actor_user_id,organization_id,action,entity_type,entity_id,
    correlation_id,outcome,details_json,created_at) VALUES(?,?,'session.revoke','session',?,?,'success',?,?)`)
    .run(actor.id, actor.organizationId, String(target.user_id), correlationId, JSON.stringify({ current: sessionId === actor.sessionTokenHash }), at);
  return { revoked: true, current: sessionId === actor.sessionTokenHash };
}

export function listTechnicalEvents(database: AppDatabase, actor: AuthenticatedUser) {
  const rows = database.prepare(`SELECT id,severity,code,message,correlation_id,request_method,request_path,created_at
    FROM technical_events WHERE organization_id=? ORDER BY id DESC LIMIT 150`)
    .all(actor.organizationId) as Record<string, unknown>[];
  return { items: rows.map((row) => ({
    id: Number(row.id), severity: String(row.severity), code: String(row.code),
    message: String(row.message), correlationId: String(row.correlation_id),
    requestMethod: String(row.request_method), requestPath: String(row.request_path),
    createdAt: String(row.created_at),
  })) };
}

export function recordTechnicalError(
  database: AppDatabase, request: IncomingMessage, correlationId: string,
  error: unknown, actor?: AuthenticatedUser | null,
) {
  const message = error instanceof Error ? error.message.slice(0, 800) : 'Unknown server error';
  database.prepare(`INSERT INTO technical_events(organization_id,actor_user_id,severity,code,message,
    correlation_id,request_method,request_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(actor?.organizationId ?? null, actor?.id ?? null, 'error', 'INTERNAL_ERROR', message,
      correlationId, String(request.method ?? ''), String(request.url ?? '').split('?')[0].slice(0, 300), nowIso());
}
