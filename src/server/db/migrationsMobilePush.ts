import type { AppDatabase } from './database.ts';
import type { Migration } from './migrationTypes.ts';

/** Undo for version 59. Not applied automatically. */
export const mobilePushRollbackSql = `
DROP TRIGGER IF EXISTS trg_notification_mobile_push;
DROP TABLE IF EXISTS mobile_push_outbox;
DROP TABLE IF EXISTS mobile_push_devices;
`;

/**
 * One-step undo for a later deploy. Drops only the two new tables and the
 * trigger, then forgets version 59 so the previous program can open the file.
 * Financial tables and notification rows are not written. Not called on startup.
 */
export function rollbackMobilePush(db: AppDatabase) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(mobilePushRollbackSql);
    const removed = db
      .prepare('DELETE FROM schema_migrations WHERE version=? AND name=?')
      .run(59, 'mobile-fcm-device-tokens');
    if (Number(removed.changes) !== 1) {
      throw new Error('Mobile push migration 59 was not the recorded row.');
    }
    db.prepare('DELETE FROM schema_migrations WHERE version=? AND name=?').run(
      60,
      'mobile-push-shade-capability',
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Undo for version 60. Not applied automatically. Devices and outbox rows stay. */
export const mobilePushShadeRollbackSql = `
ALTER TABLE mobile_push_devices DROP COLUMN push_capabilities;
`;

export type ShadeRollbackResult = {
  status: 'rolled-back' | 'already';
  droppedColumn: boolean;
  sqliteVersion: string;
};

export function sqliteVersion(db: AppDatabase) {
  return String((db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v);
}

/** SQLite 3.35 added ALTER TABLE DROP COLUMN. */
export function sqliteSupportsDropColumn(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number(part) || 0);
  if (major !== 3) return major > 3;
  if (minor !== 35) return minor > 35;
  return patch >= 0;
}

function shadeColumnPresent(db: AppDatabase) {
  return db
    .prepare('PRAGMA table_info(mobile_push_devices)')
    .all()
    .some((column) => column.name === 'push_capabilities');
}

/**
 * Forgets version 60 so a build whose newest migration is 59 can open the
 * file. Drops the nullable column when SQLite can. A second call is a no-op.
 * Refuses when a migration newer than 60 is recorded. Not called on startup.
 */
export function rollbackMobilePushShade(db: AppDatabase): ShadeRollbackResult {
  const version = sqliteVersion(db);
  const canDrop = sqliteSupportsDropColumn(version);
  const latest = Number(
    (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v,
  );
  const recorded = db.prepare('SELECT name FROM schema_migrations WHERE version=60').get() as
    { name: string } | undefined;
  if (latest > 60 || (recorded && latest !== 60)) {
    throw new Error('Shade rollback refused: version 60 is not the latest migration.');
  }
  if (recorded && recorded.name !== 'mobile-push-shade-capability') {
    throw new Error('Shade rollback refused: version 60 has an unexpected name.');
  }
  const column = shadeColumnPresent(db);
  if (!recorded && !column) return { status: 'already', droppedColumn: false, sqliteVersion: version };
  db.exec('BEGIN IMMEDIATE');
  try {
    let droppedColumn = false;
    if (column && canDrop) {
      db.exec(mobilePushShadeRollbackSql);
      droppedColumn = true;
    }
    if (recorded) {
      const removed = db
        .prepare('DELETE FROM schema_migrations WHERE version=? AND name=?')
        .run(60, 'mobile-push-shade-capability');
      if (Number(removed.changes) !== 1) {
        throw new Error('Mobile push migration 60 was not the recorded row.');
      }
    }
    db.exec('COMMIT');
    return { status: 'rolled-back', droppedColumn, sqliteVersion: version };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

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
  {
    version: 60,
    name: 'mobile-push-shade-capability',
    sql: `
  ALTER TABLE mobile_push_devices ADD COLUMN push_capabilities TEXT;
`,
  },
];
