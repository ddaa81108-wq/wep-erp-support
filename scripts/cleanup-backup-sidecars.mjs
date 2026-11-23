import console from 'node:console';
import process from 'node:process';
import { pruneBackupSidecars } from './backup-sidecars.mjs';

const [directory, mode] = process.argv.slice(2);
if (!directory || (mode !== undefined && mode !== '--apply') || process.argv.length > 4)
  throw new Error('Usage: node scripts/cleanup-backup-sidecars.mjs <backup-directory> [--apply]');
const report = pruneBackupSidecars(directory, { remove: mode === '--apply' });
console.log(JSON.stringify({ mode: mode === '--apply' ? 'apply' : 'preview', ...report }, null, 2));
if (report.warnings.length) process.exitCode = 1;
