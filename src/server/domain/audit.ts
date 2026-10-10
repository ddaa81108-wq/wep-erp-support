import type { AppDatabase } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';

export function listAuditLog(database: AppDatabase, organizationId: string, url: URL) {
  const requestedBefore = url.searchParams.get('before');
  const before = requestedBefore ? Number(requestedBefore) : null;
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) {
    throw badRequest('INVALID_PAGE_CURSOR', 'مؤشر صفحة سجل التدقيق غير صالح.');
  }
  const rows = database
    .prepare(
      `
    SELECT a.id,a.action,a.entity_type,a.entity_id,a.correlation_id,a.outcome,
      a.details_json,a.created_at,u.display_name AS actor_name,u.username AS actor_username
    FROM audit_log a
    LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE a.organization_id=? AND (? IS NULL OR a.id<?)
    ORDER BY a.id DESC LIMIT 101
  `,
    )
    .all(organizationId, before, before) as Record<string, unknown>[];
  const hasMore = rows.length > 100;
  const page = hasMore ? rows.slice(0, 100) : rows;
  return {
    items: page.map((row) => ({
      id: Number(row.id),
      action: String(row.action),
      entityType: String(row.entity_type),
      entityId: row.entity_id ? String(row.entity_id) : null,
      correlationId: String(row.correlation_id),
      outcome: String(row.outcome),
      details: JSON.parse(String(row.details_json)),
      actorName: row.actor_name ? String(row.actor_name) : 'النظام',
      actorUsername: row.actor_username ? String(row.actor_username) : null,
      createdAt: String(row.created_at),
    })),
    nextBefore: hasMore ? Number(page[page.length - 1]?.id ?? 0) : null,
  };
}
