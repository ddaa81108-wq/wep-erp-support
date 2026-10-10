import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../../db/database.ts';
import { inImmediateTransaction, nowIso } from '../../db/database.ts';
import { badRequest, conflict, notFound } from '../../http/errors.ts';
import { hashPassword } from '../../security/password.ts';
import type { AuthenticatedUser } from '../../security/sessions.ts';

type AccessLevel = 'none' | 'read' | 'manage';

function mapRequest(row: Record<string, unknown>) {
  return {
    id: String(row.id), provider: String(row.provider), email: String(row.email),
    displayName: String(row.display_name), pictureUrl: row.picture_url ? String(row.picture_url) : null,
    status: String(row.status), decisionNote: String(row.decision_note),
    requestedAt: String(row.requested_at), decidedAt: row.decided_at ? String(row.decided_at) : null,
    version: Number(row.version),
  };
}

export function listAccountRequests(database: AppDatabase, organizationId: string) {
  const rows = database.prepare(`
    SELECT * FROM account_requests WHERE organization_id = ? ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at DESC
  `).all(organizationId) as Record<string, unknown>[];
  return { items: rows.map(mapRequest) };
}

function requestedAccess(value: unknown): AccessLevel {
  if (value === 'none' || value === 'read' || value === 'manage') return value;
  throw badRequest('INVALID_SECTION_ACCESS', 'صلاحية قسم ديون العملاء غير صالحة.');
}

function uniqueUsername(database: AppDatabase, email: string) {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 50) || 'employee';
  let candidate = base.toLocaleLowerCase('en'); let suffix = 1;
  while (database.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
    candidate = `${base}-${suffix++}`.slice(0, 80).toLocaleLowerCase('en');
  }
  return candidate;
}

export async function decideAccountRequest(
  database: AppDatabase,
  actor: AuthenticatedUser,
  requestId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const decision = input.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    throw badRequest('INVALID_DECISION', 'قرار الطلب غير صالح.');
  }
  const access = requestedAccess(input.customerDebtsAccess ?? 'none');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion)) throw badRequest('EXPECTED_VERSION_REQUIRED', 'يلزم إصدار الطلب الحالي.');
  const generatedPasswordHash = decision === 'approve' ? await hashPassword(`Temp-${randomUUID()}-9`) : null;

  return inImmediateTransaction(database, () => {
    const request = database.prepare('SELECT * FROM account_requests WHERE id = ? AND organization_id = ?')
      .get(requestId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!request) throw notFound('account_request');
    if (String(request.status) !== 'pending') throw conflict('REQUEST_ALREADY_DECIDED', 'تم اتخاذ قرار في هذا الطلب من قبل.');
    if (Number(request.version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'تغير الطلب من جلسة أخرى. حدّث القائمة.');
    const decidedAt = nowIso();
    let userId: string | null = null;
    if (decision === 'approve') {
      const existing = database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(String(request.email));
      if (existing) throw conflict('EMAIL_EXISTS', 'هذا البريد مرتبط بحساب موجود بالفعل.');
      userId = randomUUID();
      const username = uniqueUsername(database, String(request.email));
      database.prepare(`
        INSERT INTO users(
          id, username, display_name, password_hash, role, email,
          password_login_enabled, must_change_password, organization_id,
          home_branch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'employee', ?, 0, 0, ?, ?, ?, ?)
      `).run(
        userId, username, String(request.display_name), generatedPasswordHash, String(request.email),
        actor.organizationId, actor.homeBranchId, decidedAt, decidedAt,
      );
      database.prepare(`
        INSERT INTO user_identities(id, user_id, provider, provider_subject, email, email_verified, created_at, updated_at)
        VALUES (?, ?, 'google', ?, ?, 1, ?, ?)
      `).run(randomUUID(), userId, String(request.provider_subject), String(request.email), decidedAt, decidedAt);
      if (access !== 'none') database.prepare(`
        INSERT INTO user_section_access(user_id, section_key, access_level, updated_at)
        VALUES (?, 'customer_debts', ?, ?)
      `).run(userId, access, decidedAt);
      const permissions = access === 'manage' ? ['debts.read', 'debts.write'] : access === 'read' ? ['debts.read'] : [];
      const insertPermission = database.prepare(`
        INSERT INTO user_permissions(user_id, permission, allowed, updated_at) VALUES (?, ?, 1, ?)
      `);
      for (const permission of permissions) insertPermission.run(userId, permission, decidedAt);
    }
    const result = database.prepare(`
      UPDATE account_requests SET status = ?, decision_note = ?, decided_at = ?,
        decided_by_user_id = ?, approved_user_id = ?, version = version + 1
      WHERE id = ? AND organization_id = ? AND version = ? AND status = 'pending'
    `).run(
      decision === 'approve' ? 'approved' : 'rejected', note, decidedAt,
      actor.id, userId, requestId, actor.organizationId, expectedVersion,
    );
    if (Number(result.changes) !== 1) throw conflict('VERSION_CONFLICT', 'تغير الطلب أثناء تنفيذ القرار.');
    database.prepare(`
      INSERT INTO audit_log(actor_user_id, organization_id, action, entity_type, entity_id, correlation_id, outcome, details_json, created_at)
      VALUES (?, ?, ?, 'account_request', ?, ?, 'success', ?, ?)
    `).run(actor.id, actor.organizationId, `account_request.${decision}`, requestId, correlationId, JSON.stringify({ userId, access }), decidedAt);
    const updated = database.prepare('SELECT * FROM account_requests WHERE id = ? AND organization_id = ?')
      .get(requestId, actor.organizationId) as Record<string, unknown>;
    return mapRequest(updated);
  });
}
