import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Native ESM release tooling is tested directly by Node.
import { sourceIdentity, buildIdentity, assertReleaseEvidence } from '../scripts/release/evidence.mjs';
// @ts-expect-error Native ESM release plan is shared with the production runner.
import { releaseChecks, RELEASE_PLAN_VERSION } from '../scripts/release/plan.mjs';
// @ts-expect-error Native ESM runner exports its isolated child-environment builder.
import { windowsPowerShellEnvironment } from '../scripts/release/run-check.mjs';

test('Windows PowerShell checks get native modules without changing the parent environment', () => {
  const before = {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    PSMODULEPATH: 'incompatible-pwsh-modules',
    TEST_VALUE: 'unchanged',
  };
  const child = windowsPowerShellEnvironment(before);
  assert.equal(before.PSMODULEPATH, 'incompatible-pwsh-modules');
  assert.equal(child.TEST_VALUE, 'unchanged');
  assert.equal(child.PSMODULEPATH, undefined);
  assert.match(child.PSModulePath.replaceAll('\\', '/'), /WindowsPowerShell\/v1\.0\/Modules/);
  assert.ok(!child.PSModulePath.includes('incompatible'));
});

test('release evidence binds the committed source, every mandatory check and both build trees', () => {
  const root = mkdtempSync(join(tmpdir(), 'abdo-release-evidence-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  try {
    git('init');
    writeFileSync(join(root, '.gitignore'), 'dist/\nvar/\n');
    writeFileSync(join(root, 'source.txt'), 'original');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture');
    mkdirSync(join(root, 'dist/server'), { recursive: true });
    mkdirSync(join(root, 'dist/web/assets'), { recursive: true });
    writeFileSync(join(root, 'dist/server/main.mjs'), 'server');
    writeFileSync(join(root, 'dist/web/index.html'), 'shell');
    writeFileSync(join(root, 'dist/web/assets/card.js'), 'card');
    const source = sourceIdentity(root),
      hash = buildIdentity(root);
    const report = {
      format: 1,
      planVersion: RELEASE_PLAN_VERSION,
      status: 'passed',
      source,
      buildHash: hash,
      completedAt: new Date().toISOString(),
      checks: releaseChecks.map((check: { id: string }) => ({ id: check.id, status: 'passed' })),
    };
    assert.equal(assertReleaseEvidence(report, source, hash), report);
    assert.throws(() => assertReleaseEvidence(null, source, hash), /missing/);
    assert.throws(() => assertReleaseEvidence({ ...report, status: 'running' }, source, hash), /incomplete/);
    assert.throws(
      () => assertReleaseEvidence({ ...report, checks: report.checks.slice(1) }, source, hash),
      /required/,
    );
    assert.throws(() => assertReleaseEvidence({ ...report, planVersion: 0 }, source, hash), /incomplete/);
    assert.throws(
      () => assertReleaseEvidence({ ...report, source: { ...source, commit: 'old' } }, source, hash),
      /Source changed/,
    );
    assert.throws(() => assertReleaseEvidence(report, { ...source, dirty: true }, hash), /local changes/);
    writeFileSync(join(root, 'source.txt'), 'changed');
    assert.throws(
      () => assertReleaseEvidence(report, sourceIdentity(root), hash, { requireClean: false }),
      /Source changed/,
    );
    writeFileSync(join(root, 'source.txt'), 'original');
    writeFileSync(join(root, 'new-source.txt'), 'untracked');
    assert.notEqual(sourceIdentity(root).hash, source.hash, 'Untracked new source is included');
    rmSync(join(root, 'new-source.txt'));
    writeFileSync(join(root, 'dist/web/assets/card.js'), 'changed-card');
    assert.throws(
      () => assertReleaseEvidence(report, sourceIdentity(root), buildIdentity(root)),
      /Build changed/,
    );
    writeFileSync(join(root, 'dist/web/assets/card.js'), 'card');
    writeFileSync(join(root, 'dist/server/main.mjs'), 'changed-server');
    assert.throws(
      () => assertReleaseEvidence(report, sourceIdentity(root), buildIdentity(root)),
      /Build changed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
