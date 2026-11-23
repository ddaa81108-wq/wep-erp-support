import { existsSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const generatedWal = /^abdo-erp-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite-wal$/;
const absent = (path) => { try { lstatSync(path); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };

/** Only old, orphaned, empty WALs and their disposable SHM files. Never databases. */
export function pruneBackupSidecars(directory, { remove = false, now = Date.now() } = {}) {
  const root = resolve(directory), eligible = [], removed = [], warnings = [];
  for (const name of readdirSync(root)) {
    if (!generatedWal.test(name)) continue;
    const wal = join(root, name), database = wal.slice(0, -4), shm = `${database}-shm`;
    try {
      const stat = lstatSync(wal);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0 || now - stat.mtimeMs < 86_400_000 || !absent(database)) continue;
      if (existsSync(shm)) {
        const companion = lstatSync(shm);
        if (!companion.isFile() || companion.isSymbolicLink() || now - companion.mtimeMs < 86_400_000) continue;
      }
      eligible.push(name);
      if (!remove) continue;
      // Recheck immediately before removal; never touch a live database's sidecars.
      if (!absent(database) || lstatSync(wal).size !== 0) continue;
      if (existsSync(shm)) { unlinkSync(shm); removed.push(`${name.slice(0, -4)}-shm`); }
      unlinkSync(wal); removed.push(name);
    } catch (e) { warnings.push(`Could not clean ${name}: ${e.message}`); }
  }
  return { eligible, removed, warnings };
}
