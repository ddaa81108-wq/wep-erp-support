import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

const mapped = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  action: String(row.action),
  entityType: String(row.entity_type),
  entityId: row.entity_id ? String(row.entity_id) : null,
  sectionKey: row.section_key ? String(row.section_key) : null,
  details: {
    ...JSON.parse(String(row.details_json)),
    ...(row.subject_name ? { subjectName: String(row.subject_name) } : {}),
    ...(row.subject_section ? { subjectSection: String(row.subject_section) } : {}),
    ...(row.collection_mode ? { paymentMode: String(row.collection_mode) } : {}),
    ...(row.collection_amount !== null && row.collection_amount !== undefined
      ? { amountUnits: Number(row.collection_amount) }
      : {}),
  },
  actorName: row.actor_name ? String(row.actor_name) : 'النظام',
  actorUsername: row.actor_username ? String(row.actor_username) : null,
  actorRole: row.actor_role ? String(row.actor_role) : null,
  createdAt: String(row.created_at),
  readAt: row.read_at ? String(row.read_at) : null,
});

export function listNotifications(db: AppDatabase, actor: AuthenticatedUser, url: URL) {
  const requestedBefore = url.searchParams.get('before');
  const before = requestedBefore ? Number(requestedBefore) : null;
  if (before !== null && (!Number.isSafeInteger(before) || before <= 0))
    throw badRequest('INVALID_PAGE_CURSOR', 'مؤشر صفحة الإشعارات غير صالح.');
  const rows = db.prepare(`SELECT n.*,u.display_name actor_name,u.username actor_username,u.role actor_role,
      c.name subject_name,c.section_key subject_section,
      submission.mode collection_mode,submission.amount_units collection_amount
    FROM notifications n
    LEFT JOIN users u ON u.id=n.actor_user_id
    LEFT JOIN collection_submissions submission
      ON n.action='collection.submit' AND submission.id=n.entity_id
    LEFT JOIN customers c ON c.id=COALESCE(
      json_extract(n.details_json,'$.customerId'),
      submission.customer_id,
      CASE WHEN n.entity_type IN ('customer','company','libyan_deposit','egyptian_deposit') THEN n.entity_id END
    )
    WHERE n.organization_id=? AND n.recipient_user_id=? AND n.read_at IS NULL
      AND (? IS NULL OR n.id<?)
    ORDER BY n.id DESC LIMIT 101`).all(actor.organizationId, actor.id, before, before) as Record<string, unknown>[];
  const hasMore = rows.length > 100;
  const page = hasMore ? rows.slice(0,100) : rows;
  const unread = db.prepare(`SELECT COUNT(*) count FROM notifications
    WHERE organization_id=? AND recipient_user_id=? AND read_at IS NULL`)
    .get(actor.organizationId,actor.id) as {count:number};
  return { items:page.map(mapped), unreadCount:Number(unread.count), nextBefore:hasMore ? Number(page.at(-1)?.id) : null };
}

export function markNotificationRead(db: AppDatabase, actor: AuthenticatedUser, id: number) {
  if (!Number.isSafeInteger(id) || id<=0) throw badRequest('INVALID_NOTIFICATION','معرّف الإشعار غير صالح.');
  const result=db.prepare(`DELETE FROM notifications
    WHERE id=? AND organization_id=? AND recipient_user_id=?`).run(id,actor.organizationId,actor.id);
  if(Number(result.changes)!==1) throw notFound('notification');
  return {id,read:true};
}

export function markAllNotificationsRead(db: AppDatabase, actor: AuthenticatedUser) {
  const result=db.prepare(`DELETE FROM notifications
    WHERE organization_id=? AND recipient_user_id=?`).run(actor.organizationId,actor.id);
  return {read:Number(result.changes)};
}

export function getNotificationPreferences(db: AppDatabase, actor: AuthenticatedUser) {
  const row=db.prepare('SELECT sound_enabled,speech_enabled FROM notification_preferences WHERE user_id=?')
    .get(actor.id) as {sound_enabled:number;speech_enabled:number}|undefined;
  return {soundEnabled:row ? Boolean(row.sound_enabled) : true,speechEnabled:row ? Boolean(row.speech_enabled) : false};
}

export function updateNotificationPreferences(db: AppDatabase, actor: AuthenticatedUser, input:Record<string,unknown>) {
  if(typeof input.soundEnabled!=='boolean'||typeof input.speechEnabled!=='boolean')
    throw badRequest('INVALID_NOTIFICATION_PREFERENCES','إعدادات الإشعارات غير صالحة.');
  db.prepare(`INSERT INTO notification_preferences(user_id,sound_enabled,speech_enabled,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET sound_enabled=excluded.sound_enabled,
    speech_enabled=excluded.speech_enabled,updated_at=excluded.updated_at`)
    .run(actor.id,input.soundEnabled?1:0,input.speechEnabled?1:0,nowIso());
  return {soundEnabled:input.soundEnabled,speechEnabled:input.speechEnabled};
}
