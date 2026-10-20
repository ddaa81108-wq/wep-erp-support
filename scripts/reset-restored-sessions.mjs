import { DatabaseSync } from 'node:sqlite';
if (!process.argv[2]) throw new Error('Database path is required');
const db = new DatabaseSync(process.argv[2]);
try {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; DELETE FROM sessions; COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
  if (Object.values(db.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error('Restored database integrity failed');
} finally { db.close(); }
