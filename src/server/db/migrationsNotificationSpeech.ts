import type { Migration } from './migrationTypes.ts';

export const notificationSpeechMigrations: Migration[] = [
  {
    version: 53,
    name: 'account-scoped-admin-notification-speech',
    sql: `CREATE TABLE notification_speech_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile TEXT NOT NULL DEFAULT 'default' CHECK(profile IN ('default','clear','egyptian')),
    voice_uri TEXT NOT NULL DEFAULT '' CHECK(length(voice_uri)<=500),
    rate REAL NOT NULL DEFAULT 0.95 CHECK(rate BETWEEN 0.7 AND 1.2),
    updated_at TEXT NOT NULL
  );`,
  },
];
