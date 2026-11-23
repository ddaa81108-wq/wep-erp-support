import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../src/server/config.ts';
import { applyMigrations, openDatabase } from '../src/server/db/database.ts';
import { migrations } from '../src/server/db/migrations.ts';
import { sqliteSupportsDropColumn, sqliteVersion } from '../src/server/db/migrationsMobilePush.ts';
import { registerMobileDevice } from '../src/server/domain/mobilePush.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import { createEmergencyBackup, validateBackupFile } from '../src/server/domain/emergencyBackup.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';
import { openSchemaFixture } from './helpers/schemaFixture.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const legacyPlan = migrations.filter((migration) => migration.version <= 59);

const legacyInsert = `
INSERT INTO mobile_push_devices(id, token, user_id, organization_id, platform, created_at, updated_at)
VALUES(?,?,?,?,?,?,?)
`;

function runRollback(databasePath: string) {
  return spawnSync(process.execPath, ['scripts/rollback-shade.ts'], {
    cwd: root,
    env: { ...process.env, ABDO_DB_PATH: databasePath },
    encoding: 'utf8',
  });
}

test('current schema backup and reconciliation stay inside this application', async () => {
  assert.equal(SCHEMA_VERSION, String(migrations.at(-1)!.version));
  const db = openDatabase(':memory:');
  const owner = { ...fixtureAdmin(db), isOwner: true } as AuthenticatedUser;
  const report = reconcileFinancials(db);
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.status, 'matched');
  const directory = mkdtempSync(join(tmpdir(), 'shade-backup-'));
  try {
    const snapshot = await createEmergencyBackup(db, owner);
    assert.equal(snapshot.schemaVersion, SCHEMA_VERSION);
    const path = join(directory, 'backup.sqlite');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(snapshot.database, 'base64'));
    validateBackupFile(path, owner.organizationId);
    const opened = openDatabase(path);
    try {
      assert.equal(opened.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get()?.v, Number(SCHEMA_VERSION));
    } finally {
      opened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
    db.close();
  }
});

test('the rollback command lets the previous migration plan open the same rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shade-rollback-'));
  const path = join(directory, 'abdo-erp.sqlite');
  const now = '2026-11-14T18:00:00.000Z';
  const token = 'c'.repeat(40);
  const db = openSchemaFixture(path, 60);
  const probe = sqliteVersion(db);
  assert.equal(sqliteSupportsDropColumn(probe), true, probe);
  const user: AuthenticatedUser = {
    id: 'shade-user',
    username: 'shade-user',
    displayName: 'مستخدم',
    role: 'admin',
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'shade',
    csrfHash: 'shade',
  };
  db.prepare(
    `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(
    user.id,
    user.username,
    user.displayName,
    'hash',
    user.role,
    user.organizationId,
    user.homeBranchId,
    now,
    now,
  );
  registerMobileDevice(db, user, { token, platform: 'android', pushCapabilities: ['shade_v1'] });
  const notice = db
    .prepare(
      `INSERT INTO notifications(organization_id,recipient_user_id,action,entity_type,details_json,created_at)
       VALUES(?,?,'customer.debt','customer','{"amountUnits":1250}',?)`,
    )
    .run(user.organizationId, user.id, now);
  const noticeId = Number(notice.lastInsertRowid);
  assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n), 1);
  const deviceId = String(db.prepare('SELECT id FROM mobile_push_devices WHERE token=?').get(token)?.id);
  db.close();

  const closed = new DatabaseSync(path);
  assert.throws(
    () => applyMigrations(closed, legacyPlan),
    /schema version 60 is newer than this application/,
  );
  closed.close();

  const rolled = runRollback(path);
  assert.equal(rolled.status, 0, `${rolled.stdout}\n${rolled.stderr}`);
  assert.match(rolled.stdout, /before-shade-rollback/);
  assert.equal(
    readdirSync(directory).some((name) => name.includes('before-shade-rollback')),
    true,
  );

  const again = runRollback(path);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /لا حاجة للتراجع/);

  const previous = new DatabaseSync(path);
  try {
    applyMigrations(previous, legacyPlan);
    assert.equal(previous.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get()?.v, 59);
    assert.equal(
      previous
        .prepare('PRAGMA table_info(mobile_push_devices)')
        .all()
        .some((column) => column.name === 'push_capabilities'),
      false,
    );
    assert.equal(
      previous.prepare('SELECT id FROM mobile_push_devices WHERE token=?').get(token)?.id,
      deviceId,
    );
    assert.equal(Number(previous.prepare('SELECT COUNT(*) n FROM mobile_push_outbox').get()?.n), 1);
    assert.equal(
      previous.prepare('SELECT details_json FROM notifications WHERE id=?').get(noticeId)?.details_json,
      '{"amountUnits":1250}',
    );
    previous
      .prepare(legacyInsert)
      .run('legacy-device', 'd'.repeat(40), user.id, user.organizationId, 'android', now, now);
    assert.equal(Number(previous.prepare('SELECT COUNT(*) n FROM mobile_push_devices').get()?.n), 2);
  } finally {
    previous.close();
  }

  const withColumn = new DatabaseSync(path);
  try {
    withColumn.exec('ALTER TABLE mobile_push_devices ADD COLUMN push_capabilities TEXT');
    applyMigrations(withColumn, legacyPlan);
    withColumn
      .prepare(legacyInsert)
      .run('legacy-extra', 'e'.repeat(40), user.id, user.organizationId, 'android', now, now);
    assert.equal(
      withColumn.prepare('SELECT push_capabilities FROM mobile_push_devices WHERE id=?').get('legacy-extra')
        ?.push_capabilities,
      null,
    );
  } finally {
    withColumn.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the rollback command refuses a database newer than version 60', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shade-refuse-'));
  const path = join(directory, 'abdo-erp.sqlite');
  const db = openDatabase(path);
  db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)').run(
    Number(SCHEMA_VERSION) + 1,
    'future',
    new Date().toISOString(),
  );
  db.close();
  const refused = runRollback(path);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /مرفوض/);
  const check = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      check.prepare('SELECT name FROM schema_migrations WHERE version=60').get()?.name,
      'mobile-push-shade-capability',
    );
    assert.equal(
      check
        .prepare('PRAGMA table_info(mobile_push_devices)')
        .all()
        .some((column) => column.name === 'push_capabilities'),
      true,
    );
  } finally {
    check.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
