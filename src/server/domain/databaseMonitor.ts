import { lstat, readdir, readFile, statfs } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { AppDatabase } from '../db/database.ts';
import type { ServerConfig } from '../config.ts';
import { backupStatus } from './backupStatus.ts';

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink() ? info.size : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    return null;
  }
}
export async function databaseMonitor(db: AppDatabase, config: ServerConfig) {
  const databasePath = String(
    db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main')?.file ?? '',
  );
  const installedRoot = join(process.env.ProgramData ?? 'C:\\ProgramData', 'AbdoErpLocal');
  const isInstalled =
    databasePath &&
    resolve(databasePath).toLowerCase() === resolve(installedRoot, 'data', 'abdo-erp.sqlite').toLowerCase();
  // A local preview must never report the installed server's backup schedule as its own.
  const schedule = isInstalled ? backupStatus() : null;
  const folder = resolve(
    config.backupDirectory ||
      schedule?.output ||
      (isInstalled
        ? join(installedRoot, 'backups')
        : join(dirname(databasePath || config.databasePath), 'backups')),
  );
  const sizes = databasePath
    ? await Promise.all([
        fileSize(databasePath),
        fileSize(databasePath + '-wal'),
        fileSize(databasePath + '-shm'),
      ])
    : [null, null, null];
  let diskFreeBytes: number | null = null;
  if (databasePath) {
    try {
      const disk = await statfs(dirname(databasePath));
      diskFreeBytes = disk.bavail * disk.bsize;
    } catch {
      /* unavailable is not zero */
    }
  }
  let folderState: 'readable' | 'missing' | 'unavailable' = 'readable';
  const entries: Array<{
    name: string;
    sizeBytes: number;
    modifiedAt: string;
    report: 'recorded' | 'missing' | 'invalid';
    recordedAt: string | null;
    schemaVersion: number | null;
  }> = [];
  let unreadableFiles = 0;
  try {
    const files = (await readdir(folder, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.sqlite'),
    );
    for (const file of files) {
      try {
        const info = await lstat(join(folder, file.name));
        if (!info.isFile() || info.isSymbolicLink()) continue;
        entries.push({
          name: file.name,
          sizeBytes: info.size,
          modifiedAt: info.mtime.toISOString(),
          report: 'missing',
          recordedAt: null,
          schemaVersion: null,
        });
      } catch {
        unreadableFiles++;
      }
    }
  } catch (error) {
    folderState = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
  }
  entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
  const visible = entries.slice(0, 100);
  await Promise.all(
    visible.map(async (entry) => {
      const reportPath = join(folder, entry.name + '.json');
      try {
        const info = await lstat(reportPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) {
          entry.report = 'invalid';
          return;
        }
        const report = JSON.parse(await readFile(reportPath, 'utf8'));
        if (
          report.manifestVersion !== 1 ||
          report.file !== entry.name ||
          report.fileSizeBytes !== entry.sizeBytes ||
          report.integrity !== 'ok' ||
          report.foreignKeyProblems !== 0 ||
          !/^[a-f0-9]{64}$/i.test(report.sha256 ?? '') ||
          !Number.isInteger(report.schemaVersion) ||
          !Number.isFinite(Date.parse(report.createdAt))
        ) {
          entry.report = 'invalid';
          return;
        }
        entry.report = 'recorded';
        entry.recordedAt = report.createdAt;
        entry.schemaVersion = report.schemaVersion;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') entry.report = 'invalid';
      }
    }),
  );
  const pageSize = Number(db.prepare('PRAGMA page_size').get()!.page_size);
  const pageCount = Number(db.prepare('PRAGMA page_count').get()!.page_count);
  const freePages = Number(db.prepare('PRAGMA freelist_count').get()!.freelist_count);
  return {
    checkedAt: new Date().toISOString(),
    database: {
      name: databasePath ? basename(databasePath) : 'قاعدة مؤقتة في الذاكرة',
      path: databasePath || null,
      sizeBytes: sizes[0],
      walBytes: sizes[1],
      shmBytes: sizes[2],
      diskFreeBytes,
      allocatedBytes: pageCount * pageSize,
      reusableBytes: freePages * pageSize,
      schemaVersion: Number(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v),
    },
    backups: {
      folder,
      folderState,
      count: entries.length,
      totalBytes: entries.reduce((sum, item) => sum + item.sizeBytes, 0),
      unreadableFiles,
      items: visible,
      limit: 100,
    },
    schedule: schedule
      ? {
          hours: schedule.hours,
          timezone: schedule.timezone,
          retentionCount: schedule.retentionCount,
          lastSuccess: schedule.lastSuccess,
          hasError: Boolean(schedule.lastError),
          matchesFolder: resolve(schedule.output).toLowerCase() === folder.toLowerCase(),
        }
      : null,
  };
}
