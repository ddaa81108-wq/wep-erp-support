import { createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const argumentsList = process.argv.slice(2);
const databaseArgument = argumentsList.find((value) => !value.startsWith('--'));
const requireManifest = argumentsList.includes('--require-manifest');
const manifestArgument = argumentsList.find((value) => value.startsWith('--manifest='));

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 2;
}

try {
  if (!databaseArgument) throw new Error('Database path is required.');
  const path = resolve(databaseArgument);
  const manifestPath = resolve(manifestArgument?.slice('--manifest='.length) || `${path}.json`);
  const manifestExists = existsSync(manifestPath);
  if (requireManifest && !manifestExists) throw new Error(`Backup manifest is missing: ${manifestPath}`);

  let manifest = null;
  let sha256 = null;
  if (manifestExists) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.manifestVersion !== 1) throw new Error('Unsupported backup manifest version.');
    if (manifest.file !== basename(path)) throw new Error('Backup manifest file name does not match the database file.');
    if (!/^[a-f\d]{64}$/i.test(String(manifest.sha256 ?? ''))) throw new Error('Backup manifest SHA-256 is invalid.');
    sha256 = await hashFile(path);
    const expected = Buffer.from(String(manifest.sha256).toLowerCase(), 'hex');
    const actual = Buffer.from(sha256, 'hex');
    if (!timingSafeEqual(expected, actual)) throw new Error('Backup SHA-256 does not match its manifest.');
    if (Number(manifest.fileSizeBytes) !== statSync(path).size) throw new Error('Backup size does not match its manifest.');
  }

  const database = new DatabaseSync(path, { readOnly: true });
  let integrity;
  let foreignKeyProblems;
  let schemaVersion;
  try {
    integrity = String(Object.values(database.prepare('PRAGMA quick_check').get())[0] ?? 'unknown');
    foreignKeyProblems = database.prepare('PRAGMA foreign_key_check').all().length;
    schemaVersion = Number(
      database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version,
    );
  } finally {
    database.close();
  }

  if (manifest && Number(manifest.schemaVersion) !== schemaVersion) {
    throw new Error('Backup schema version does not match its manifest.');
  }
  const result = {
    ok: integrity === 'ok' && foreignKeyProblems === 0 && schemaVersion >= 14,
    path,
    integrity,
    foreignKeyProblems,
    schemaVersion,
    manifestVerified: Boolean(manifest),
    manifestPath: manifest ? manifestPath : null,
    sha256,
  };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 2;
} catch (error) {
  fail(error);
}
