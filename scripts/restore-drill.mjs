import { randomUUID } from 'node:crypto';
import console from 'node:console';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

function run(script, argumentsList, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...argumentsList], { encoding: 'utf8' });
  if (result.status !== expectedStatus) {
    throw new Error(`Unexpected exit from ${basename(script)}: ${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

const root = mkdtempSync(join(tmpdir(), 'abdo-erp-restore-drill-'));
const sourcePath = join(root, 'source.sqlite');
const backupsPath = join(root, 'backups');
const marker = randomUUID();
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const backupScript = join(scriptRoot, 'backup-database.mjs');
const verifierScript = join(scriptRoot, 'verify-database.mjs');

try {
  mkdirSync(backupsPath);
  const source = new DatabaseSync(sourcePath);
  try {
    source.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations (version) VALUES (34);
      CREATE TABLE restore_drill (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);
    `);
    source.prepare('INSERT INTO restore_drill (marker) VALUES (?)').run(marker);
  } finally {
    source.close();
  }

  const backupResult = run(backupScript, [sourcePath, backupsPath, '2']);
  const backupPath = backupResult.outputPath;
  const verified = run(verifierScript, [backupPath, '--require-manifest']);
  if (!verified.ok || !verified.manifestVerified) throw new Error('Valid backup was not fully verified.');

  const restoredPath = join(root, 'restored.sqlite');
  copyFileSync(backupPath, restoredPath);
  const restoredVerification = run(verifierScript, [restoredPath]);
  if (!restoredVerification.ok) throw new Error('Restored copy failed verification.');
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    const restoredMarker = restored.prepare('SELECT marker FROM restore_drill WHERE id = 1').get()?.marker;
    if (restoredMarker !== marker) throw new Error('Restored data marker does not match its source.');
  } finally {
    restored.close();
  }

  const tamperedRoot = join(root, 'tampered');
  mkdirSync(tamperedRoot);
  const tamperedPath = join(tamperedRoot, basename(backupPath));
  copyFileSync(backupPath, tamperedPath);
  copyFileSync(`${backupPath}.json`, `${tamperedPath}.json`);
  const bytes = readFileSync(tamperedPath);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  writeFileSync(tamperedPath, bytes);
  const tamperedResult = run(verifierScript, [tamperedPath, '--require-manifest'], 2);
  if (tamperedResult.ok || !String(tamperedResult.error).includes('SHA-256')) {
    throw new Error('Tampered backup was not rejected by its SHA-256 manifest.');
  }

  const missingManifestPath = join(root, 'missing-manifest.sqlite');
  copyFileSync(backupPath, missingManifestPath);
  const missingManifestResult = run(verifierScript, [missingManifestPath, '--require-manifest'], 2);
  if (missingManifestResult.ok || !String(missingManifestResult.error).includes('manifest is missing')) {
    throw new Error('Manifest-less backup was not rejected.');
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        databaseIntegrity: restoredVerification.integrity,
        foreignKeyProblems: restoredVerification.foreignKeyProblems,
        schemaVersion: restoredVerification.schemaVersion,
        markerPreserved: true,
        sha256Verified: true,
        tamperedBackupRejected: true,
        missingManifestRejected: true,
        generatedBackupCount: readdirSync(backupsPath).length / 2,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
