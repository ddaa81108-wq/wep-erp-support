export const BACKUP_DOWNLOAD_LIMIT_BYTES = 48 * 1024 * 1024;
export const BACKUP_ENCRYPTION_LIMIT_BYTES = 49 * 1024 * 1024;

/** Warn early; never reinterpret WAL bytes as the size of a consistent copy. */
export function backupCapacityFor(databaseBytes: number) {
  const warningThresholdBytes = Math.floor(BACKUP_DOWNLOAD_LIMIT_BYTES * 0.8);
  return {
    databaseBytes,
    emergencyLimitBytes: BACKUP_DOWNLOAD_LIMIT_BYTES,
    scheduledLimitBytes: BACKUP_ENCRYPTION_LIMIT_BYTES,
    warningThresholdBytes,
    level: databaseBytes > BACKUP_DOWNLOAD_LIMIT_BYTES ? 'limit' as const
      : databaseBytes >= warningThresholdBytes ? 'warning' as const : 'ok' as const,
  };
}
