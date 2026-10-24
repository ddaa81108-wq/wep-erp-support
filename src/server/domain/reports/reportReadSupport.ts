import type { AppDatabase } from '../../db/database.ts';

/** Read one SQLite snapshot without running any business commit observers. */
export function readReportSnapshot<T>(db: AppDatabase, read: () => T): T {
  const nested = db.isTransaction;
  if (!nested) db.exec('BEGIN');
  try {
    const result = read();
    if (!nested) db.exec('COMMIT');
    return result;
  } catch (error) {
    if (!nested) db.exec('ROLLBACK');
    throw error;
  }
}
