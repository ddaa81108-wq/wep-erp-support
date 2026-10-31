import {
  defaultNotificationSpeech,
  type NotificationSpeechSettings,
} from '../../shared/notificationSpeech.ts';
import { nowIso, type AppDatabase } from '../db/database.ts';
import { badRequest, forbidden } from '../http/errors.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

export function getNotificationSpeech(db: AppDatabase, actor: AuthenticatedUser): NotificationSpeechSettings {
  if (actor.role !== 'admin') throw forbidden('users.manage');
  const row = db
    .prepare('SELECT profile,voice_uri,rate FROM notification_speech_settings WHERE user_id=?')
    .get(actor.id) as
    { profile: NotificationSpeechSettings['profile']; voice_uri: string; rate: number } | undefined;
  return row
    ? { profile: row.profile, voiceURI: row.voice_uri, rate: row.rate }
    : { ...defaultNotificationSpeech };
}

export function updateNotificationSpeech(
  db: AppDatabase,
  actor: AuthenticatedUser,
  input: Record<string, unknown>,
) {
  if (actor.role !== 'admin') throw forbidden('users.manage');
  if (
    !['default', 'clear', 'egyptian'].includes(String(input.profile)) ||
    typeof input.voiceURI !== 'string' ||
    input.voiceURI.length > 500 ||
    typeof input.rate !== 'number' ||
    !Number.isFinite(input.rate) ||
    input.rate < 0.7 ||
    input.rate > 1.2
  )
    throw badRequest('INVALID_SPEECH_SETTINGS', 'إعدادات صوت الإشعارات غير صالحة.');
  db.prepare(
    `INSERT INTO notification_speech_settings(user_id,profile,voice_uri,rate,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,voice_uri=excluded.voice_uri,rate=excluded.rate,updated_at=excluded.updated_at`,
  ).run(actor.id, String(input.profile), input.voiceURI, input.rate, nowIso());
  return getNotificationSpeech(db, actor);
}
