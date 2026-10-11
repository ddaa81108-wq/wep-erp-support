import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
