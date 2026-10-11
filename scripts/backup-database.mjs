import { createHash } from 'node:crypto';
import console from 'node:console';
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { backup, DatabaseSync } from 'node:sqlite';

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

const sourcePath = resolve(process.argv[2] ?? 'C:\\ProgramData\\AbdoErpLocal\\data\\abdo-erp.sqlite');
const outputRoot = resolve(process.argv[3] ?? 'C:\\ProgramData\\AbdoErpLocal\\backups');
const retentionCount = Number(process.argv[4] ?? 30);
if (!Number.isSafeInteger(retentionCount) || retentionCount < 1 || retentionCount > 365) {
  throw new Error('Backup retention count must be an integer between 1 and 365.');
}
mkdirSync(outputRoot, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = join(outputRoot, `abdo-erp-${stamp}.sqlite`);
let backupCommitted = false;

try {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, outputPath);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(outputPath, { readOnly: true });
  let integrity = 'unknown';
  let foreignKeyProblems = -1;
  let schemaVersion = 0;
  try {
    integrity = String(Object.values(copy.prepare('PRAGMA quick_check').get())[0] ?? 'unknown');
    foreignKeyProblems = copy.prepare('PRAGMA foreign_key_check').all().length;
    schemaVersion = Number(
      copy.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version,
    );
  } finally {
    copy.close();
  }
  if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${integrity}`);
  if (foreignKeyProblems !== 0) throw new Error(`Backup has ${foreignKeyProblems} foreign-key problem(s).`);
  if (schemaVersion < 14) throw new Error(`Backup schema version is unsupported: ${schemaVersion}`);

  const sha256 = await hashFile(outputPath);
  const manifest = {
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    source: basename(sourcePath),
    file: basename(outputPath),
    fileSizeBytes: statSync(outputPath).size,
    schemaVersion,
    integrity,
    foreignKeyProblems,
    sha256,
  };
  const manifestPath = `${outputPath}.json`;
  const temporaryManifestPath = `${manifestPath}.tmp`;
  writeFileSync(temporaryManifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  renameSync(temporaryManifestPath, manifestPath);
  backupCommitted = true;

  const warnings = [];
  const removed = [];
  try {
    const retained = readdirSync(outputRoot)
      .filter((name) => /^abdo-erp-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(name))
      .map((name) => ({ name, modifiedAt: statSync(join(outputRoot, name)).mtimeMs }))
      .sort((left, right) =>
        left.name === basename(outputPath)
          ? -1
          : right.name === basename(outputPath)
            ? 1
            : right.modifiedAt - left.modifiedAt,
      );
    for (const old of retained.slice(retentionCount)) {
      try {
        const databaseFile = join(outputRoot, old.name);
        unlinkSync(databaseFile);
        const oldManifest = `${databaseFile}.json`;
        try {
          unlinkSync(oldManifest);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        removed.push(old.name);
      } catch (error) {
        warnings.push(`Could not prune ${old.name}: ${error.message}`);
      }
    }
  } catch (error) {
    warnings.push(`Could not list retention candidates: ${error.message}`);
  }

  console.log(
    JSON.stringify(
      { status: warnings.length ? 'warning' : 'ok', outputPath, retentionCount, removed, warnings, manifest },
      null,
      2,
    ),
  );
} catch (error) {
  if (!backupCommitted) {
    rmSync(outputPath, { force: true });
    rmSync(`${outputPath}.json.tmp`, { force: true });
  }
  throw error;
}
