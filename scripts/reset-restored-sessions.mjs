import { DatabaseSync } from 'node:sqlite';
if (!process.argv[2]) throw new Error('Database path is required');
const db = new DatabaseSync(process.argv[2]);
try {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; DELETE FROM sessions;');
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='mfa_challenges'").get()) {
    db.exec('DELETE FROM mfa_challenges; UPDATE user_mfa SET pending_secret=NULL,pending_session=NULL,pending_expires_at=NULL;');
  }
  db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
  if (Object.values(db.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error('Restored database integrity failed');
} finally { db.close(); }
