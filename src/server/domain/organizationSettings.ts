import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction, nowIso } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

function mapSettings(row: Record<string, unknown>) {
  return {
    organizationId: String(row.organization_id),
    systemName: String(row.system_name),
    timezone: String(row.timezone),
    locale: String(row.locale),
    employeeSectionsVisible: Number(row.employee_sections_visible) === 1,
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

export function getOrganizationSettings(database: AppDatabase, organizationId: string) {
  const row = database.prepare(
    'SELECT * FROM organization_settings WHERE organization_id = ?',
  ).get(organizationId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('organization_settings');
  return mapSettings(row);
}

export function updateOrganizationSettings(
  database: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
  correlationId: string,
) {
  const systemName = typeof input.systemName === 'string' ? input.systemName.trim() : '';
  if (systemName.length < 2 || systemName.length > 80) {
    throw badRequest('INVALID_SYSTEM_NAME', 'اسم المنظومة يجب أن يكون بين 2 و80 محرفًا.');
  }
  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!['Africa/Tripoli', 'Africa/Cairo'].includes(timezone)) {
    throw badRequest('INVALID_TIMEZONE', 'المنطقة الزمنية غير معتمدة.');
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw badRequest('EXPECTED_VERSION_REQUIRED', 'يلزم إصدار الإعدادات الحالي.');
  }
  const employeeSectionsVisible = input.employeeSectionsVisible !== false;
  return inImmediateTransaction(database, () => {
    const updatedAt = nowIso();
    const result = database.prepare(`
      UPDATE organization_settings
      SET system_name = ?, timezone = ?, employee_sections_visible = ?,
        updated_by_user_id = ?, version = version + 1, updated_at = ?
      WHERE organization_id = ? AND version = ?
    `).run(
      systemName,
      timezone,
      employeeSectionsVisible ? 1 : 0,
      actor.id,
      updatedAt,
      actor.organizationId,
      expectedVersion,
    );
    if (Number(result.changes) !== 1) {
      throw conflict('VERSION_CONFLICT', 'تغيرت الإعدادات من جلسة أخرى. حدّث الصفحة.');
    }
    database.prepare(`
      INSERT INTO audit_log(
        actor_user_id, organization_id, action, entity_type, entity_id,
        correlation_id, outcome, details_json, created_at
      ) VALUES (?, ?, 'settings.organization.update', 'organization_settings', ?, ?, 'success', ?, ?)
    `).run(
      actor.id,
      actor.organizationId,
      actor.organizationId,
      correlationId,
      JSON.stringify({ systemName, timezone, employeeSectionsVisible }),
      updatedAt,
    );
    return getOrganizationSettings(database, actor.organizationId);
  });
}
