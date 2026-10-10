import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import { hashPassword, validatePasswordPolicy } from '../security/password.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { mapUser } from './userQueries.ts';
import { persistUserAccess, resolveUserAccess } from './userAccess.ts';

export { ASSIGNABLE_PERMISSIONS } from '../../shared/sections.ts';
export type { SectionAccessLevel } from '../../shared/sections.ts';
export { listUsers } from './userQueries.ts';

function cleanText(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') throw badRequest('INVALID_FIELD', `الحقل ${field} مطلوب.`);
  const result = value.trim();
  if (result.length < min || result.length > max)
    throw badRequest('INVALID_FIELD', `قيمة الحقل ${field} غير صالحة.`);
  return result;
}

function cleanPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 256) {
    throw badRequest('INVALID_FIELD', 'كلمة المرور يجب أن تكون بين 10 و256 محرفًا.');
  }
  try {
    validatePasswordPolicy(value);
  } catch {
    throw badRequest('PASSWORD_POLICY', 'كلمة المرور يجب أن تحتوي على حرف ورقم على الأقل.');
  }
  return value;
}

function accountRole(value: unknown): 'admin' | 'employee' {
  if (value !== undefined && value !== 'admin' && value !== 'employee') {
    throw badRequest('INVALID_ACCOUNT_ROLE', 'نوع الحساب غير صالح.');
  }
  return value === 'admin' ? 'admin' : 'employee';
}

function cleanEmail(value: unknown, required: boolean) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string') throw badRequest('INVALID_EMAIL', 'البريد الإلكتروني غير صالح.');
  const email = value.trim().toLocaleLowerCase('en');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('INVALID_EMAIL', 'البريد الإلكتروني غير صالح.');
  }
  return email;
}



export async function createEmployee(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const username = cleanText(input.username, 'username', 3, 80).toLocaleLowerCase('en');
  const displayName = cleanText(input.displayName, 'displayName', 2, 120);
  const role = accountRole(input.role);
  if (role === 'admin' && actor.isOwner !== true) {
    throw forbidden('owner.admin.create');
  }
  const email = cleanEmail(input.email, role === 'admin');
  const password = cleanPassword(input.password);
  const passwordHash = await hashPassword(password);
  const access = resolveUserAccess(input);
  return inImmediateTransaction(database, () => {
    const duplicate = database.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (duplicate) throw conflict('USERNAME_EXISTS', 'اسم المستخدم مستخدم من قبل.');
    if (email && database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
      throw conflict('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم من قبل.');
    }
    const id = randomUUID();
    const createdAt = nowIso();
    database
      .prepare(
        `
      INSERT INTO users(
        id, username, display_name, password_hash, role, email, is_owner,
        organization_id, home_branch_id, must_change_password, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
    `,
      )
      .run(
        id,
        username,
        displayName,
        passwordHash,
        role,
        email,
        actor.organizationId,
        actor.homeBranchId,
        createdAt,
        createdAt,
      );
    if (role === 'employee') persistUserAccess(database, id, access, createdAt);
    database
      .prepare(
        `
      INSERT INTO audit_log(actor_user_id, organization_id, action, entity_type, entity_id, correlation_id, outcome, details_json, created_at)
      VALUES (?, ?, 'user.create', 'user', ?, ?, 'success', ?, ?)
    `,
      )
      .run(
        actor.id,
        actor.organizationId,
        id,
        correlationId,
        JSON.stringify({ role, email, permissions: role === 'employee' ? access.assigned : ['*'] }),
        createdAt,
      );
    const row = database.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
    return mapUser(
      row,
      role === 'employee' ? access.assigned : [],
      access.customerDebts,
      access.companyDebts,
      access.libyanDeposits,
      access.egyptianDeposits,
      access.masraweya,
      access.purchases,
      access.treasury,
      access.reports,
    );
  });
}

export async function updateEmployee(
  database: AppDatabase,
  actor: AuthenticatedUser,
  userId: string,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const password =
    input.password === undefined || input.password === '' ? null : cleanPassword(input.password);
  const passwordHash = password ? await hashPassword(password) : null;
  return inImmediateTransaction(database, () => {
    const current = database
      .prepare('SELECT * FROM users WHERE id = ? AND organization_id = ?')
      .get(userId, actor.organizationId) as Record<string, unknown> | undefined;
    if (!current) throw notFound('user');
    const currentRole = String(current.role) as 'admin' | 'employee';
    const currentIsOwner = Number(current.is_owner) === 1;
    if (currentIsOwner) {
      throw conflict('OWNER_ACCOUNT_PROTECTED', 'حساب المالك الرئيسي محمي ولا يُعدّل من إدارة الحسابات.');
    }
    if (currentRole === 'admin' && actor.isOwner !== true) {
      throw forbidden('owner.admin.update');
    }
    const expectedVersion = Number(input.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion))
      throw badRequest('EXPECTED_VERSION_REQUIRED', 'يلزم إصدار المستخدم الحالي.');
    if (expectedVersion !== Number(current.version))
      throw conflict('VERSION_CONFLICT', 'عُدل المستخدم من جلسة أخرى. حدّث القائمة.');
    const displayName = cleanText(input.displayName, 'displayName', 2, 120);
    const email = cleanEmail(input.email ?? current.email, currentRole === 'admin');
    if (email && database.prepare(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?',
    ).get(email, userId)) {
      throw conflict('EMAIL_EXISTS', 'البريد الإلكتروني مستخدم من قبل.');
    }
    const isActive = input.isActive === true;
    const access = resolveUserAccess(input);
    const updatedAt = nowIso();
    const nextVersion = expectedVersion + 1;
    const updated = database
      .prepare(
        `
      UPDATE users SET display_name = ?, email = ?, is_active = ?, version = ?, updated_at = ?,
        password_hash = CASE WHEN ? IS NULL THEN password_hash ELSE ? END,
        must_change_password = CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END
      WHERE id = ? AND organization_id = ? AND version = ?
    `,
      )
      .run(
        displayName,
        email,
        isActive ? 1 : 0,
        nextVersion,
        updatedAt,
        password,
        passwordHash,
        password,
        userId,
        actor.organizationId,
        expectedVersion,
      );
    if (Number(updated.changes) !== 1) throw conflict('VERSION_CONFLICT', 'عُدل المستخدم أثناء تنفيذ الطلب.');
    if (currentRole === 'employee') {
      database.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM user_section_access WHERE user_id = ?').run(userId);
      persistUserAccess(database, userId, access, updatedAt);
    }
    if (!isActive || password)
      database
        .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(updatedAt, userId);
    database
      .prepare(
        `
      INSERT INTO audit_log(actor_user_id, organization_id, action, entity_type, entity_id, correlation_id, outcome, details_json, created_at)
      VALUES (?, ?, 'user.update', 'user', ?, ?, 'success', ?, ?)
    `,
      )
      .run(
        actor.id,
        actor.organizationId,
        userId,
        correlationId,
        JSON.stringify({
          role: currentRole,
          email,
          isActive,
          permissions: currentRole === 'employee' ? access.assigned : ['*'],
          passwordReset: Boolean(password),
        }),
        updatedAt,
      );
    const row = database
      .prepare('SELECT * FROM users WHERE id = ? AND organization_id = ?')
      .get(userId, actor.organizationId) as Record<string, unknown>;
    return mapUser(
      row,
      currentRole === 'employee' ? access.assigned : [],
      access.customerDebts,
      access.companyDebts,
      access.libyanDeposits,
      access.egyptianDeposits,
      access.masraweya,
      access.purchases,
      access.treasury,
      access.reports,
    );
  });
}
