import type { Migration } from './migrationTypes.ts';

/** Undo for version 59. Not applied automatically. */
export const mobilePushRollbackSql = `
DROP TRIGGER IF EXISTS trg_notification_mobile_push;
DROP TABLE IF EXISTS mobile_push_outbox;
DROP TABLE IF EXISTS mobile_push_devices;
`;

export const mobilePushMigrations: Migration[] = [
  {
    version: 59,
    name: 'mobile-fcm-device-tokens',
    sql: `
  CREATE TABLE mobile_push_devices (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_mobile_push_user ON mobile_push_devices(user_id, organization_id);
  CREATE TABLE mobile_push_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES mobile_push_devices(id) ON DELETE CASCADE,
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    UNIQUE(device_id, notification_id)
  ) STRICT;
  CREATE INDEX idx_mobile_push_due ON mobile_push_outbox(next_attempt_at, id);
  CREATE TRIGGER trg_notification_mobile_push AFTER INSERT ON notifications BEGIN
    INSERT OR IGNORE INTO mobile_push_outbox(device_id, notification_id)
      SELECT id, NEW.id FROM mobile_push_devices
      WHERE user_id = NEW.recipient_user_id AND organization_id = NEW.organization_id;
  END;
`,
  },
];
