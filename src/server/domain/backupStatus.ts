import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppDatabase } from '../db/database.ts';

export function installedDatabase(database: AppDatabase) {
  const path = database.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
  return process.platform === 'win32' && typeof path === 'string' && path.length > 0 &&
    resolve(path).toLowerCase() === resolve(process.env.ProgramData ?? 'C:\\ProgramData', 'AbdoErpLocal/data/abdo-erp.sqlite').toLowerCase();
}

export function backupStatus() {
  if (process.platform !== 'win32') return null;
  try {
    const value = JSON.parse(readFileSync(join(process.env.ProgramData ?? 'C:\\ProgramData', 'AbdoErpLocal', 'backup-schedule.json'), 'utf8'));
    if (value.timezone !== 'Africa/Tripoli' || !Array.isArray(value.hours) || typeof value.output !== 'string') return null;
    return {
      output: value.output as string,
      timezone: value.timezone as string,
      hours: value.hours as number[],
      retentionCount: Number(value.retentionCount),
      lastSuccess: typeof value.lastSuccess === 'string' ? value.lastSuccess : null,
      lastFile: typeof value.lastFile === 'string' ? value.lastFile : null,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
    };
  } catch {
    return null;
  }
}
