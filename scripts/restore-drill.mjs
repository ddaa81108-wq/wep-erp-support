import assert from 'node:assert/strict';
import console from 'node:console';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { addCustomerTransaction } from '../src/server/domain/customerTransactions.ts';
import { addTreasuryCashEntry, treasuryDashboard } from '../src/server/domain/treasury.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import { startReportScheduler } from '../src/server/domain/reports/reportScheduler.ts';
import { fixtureAdmin } from '../tests/helpers/financialFixture.ts';

function snapshot(database) {
  return Object.fromEntries(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => [
        name,
        database
          .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .all()
          .map((row) => JSON.stringify(row))
          .sort(),
      ]),
  );
}

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
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const backupScript = join(scriptRoot, 'backup-database.mjs');
const verifierScript = join(scriptRoot, 'verify-database.mjs');

try {
  mkdirSync(backupsPath);
  const source = openDatabase(sourcePath);
  const actor = fixtureAdmin(source);
  const stop = startReportScheduler(source);
  let expectedTables;
  let expectedTreasury;
  try {
    for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp']) {
      const created = createCustomer(
        source,
        actor,
        { requestId: `drill-create-${kind}`, name: `Drill ${kind}`, openingBalance: 1000 },
        'drill',
        kind,
      );
      addCustomerTransaction(
        source,
        actor,
        created.body.customer.id,
        {
          requestId: `drill-payment-${kind}`,
          expectedVersion: 1,
          type: 'payment',
          inputValue: 100,
          date: new Date().toISOString().slice(0, 10),
        },
        'drill',
        kind,
      );
    }
    setEgyptianDepositRate(source, actor, 5);
    addTreasuryCashEntry(
      source,
      actor,
      {
        requestId: 'drill-cash-in',
        direction: 'in',
        amountUnits: 500,
        expectedVersion: treasuryDashboard(source, actor.organizationId).cashVersion,
      },
      'drill',
    );
    expectedTables = snapshot(source);
    expectedTreasury = treasuryDashboard(source, actor.organizationId);
  } finally {
    stop();
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
  const restored = openDatabase(restoredPath);
  try {
    assert.deepEqual(snapshot(restored), expectedTables, 'All application tables must survive restoration');
    assert.deepEqual(
      treasuryDashboard(restored, actor.organizationId),
      expectedTreasury,
      'Restored financial totals must match',
    );
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM debt_transactions').get().n, 8);
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

  // Simulate an undeletable retention candidate using a directory, without
  // changing OS permissions or touching any operational backup.
  const blockedCandidate = join(backupsPath, 'abdo-erp-2000-01-01T00-00-00-000Z.sqlite');
  mkdirSync(blockedCandidate);
  utimesSync(blockedCandidate, new Date('2000-01-01'), new Date('2000-01-01'));
  const retentionResult = run(backupScript, [sourcePath, backupsPath, '1']);
  assert.equal(retentionResult.status, 'warning');
  assert.ok(retentionResult.warnings.length > 0);
  assert.equal(
    run(verifierScript, [retentionResult.outputPath, '--require-manifest']).ok,
    true,
    'Retention failure must never discard the new verified backup',
  );

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        databaseIntegrity: restoredVerification.integrity,
        foreignKeyProblems: restoredVerification.foreignKeyProblems,
        schemaVersion: restoredVerification.schemaVersion,
        applicationTablesPreserved: Object.keys(expectedTables).length,
        financialTotalsPreserved: true,
        sha256Verified: true,
        tamperedBackupRejected: true,
        missingManifestRejected: true,
        retentionFailurePreservedNewBackup: true,
        generatedBackupCount: readdirSync(backupsPath, { withFileTypes: true }).filter(
          (entry) => entry.isFile() && entry.name.endsWith('.sqlite'),
        ).length,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
