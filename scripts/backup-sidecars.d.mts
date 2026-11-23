export function pruneBackupSidecars(directory: string, options?: { remove?: boolean; now?: number }): {
  eligible: string[]; removed: string[]; warnings: string[];
};
