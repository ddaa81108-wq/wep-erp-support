import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
// @ts-expect-error Native ESM helper selects the Windows shell used in deployment.
import * as windowsShell from '../scripts/release/windows-shell.mjs';
const { windowsPowerShellExecutable, windowsPowerShellEnvironment } = windowsShell;

test(
  'release retention preserves current/protected data and verifies recoverable archives',
  { skip: process.platform !== 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'erp-program-retention-'));
    const report = join(root, 'deployment.json');
    const names = Array.from({ length: 5 }, (_, i) => '.deploy-rollback-' + String(i).padStart(32, '0'));
    const executable = windowsPowerShellExecutable(process.env);
    const environment = windowsPowerShellEnvironment(process.env);
    // Exercise a normal Windows installation, even when the developer has pwsh 7.
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key];
    environment.Path = [join(process.env.SystemRoot || 'C:\\Windows', 'System32'), dirname(executable)].join(
      ';',
    );
    const run = (apply = false) => {
      const result = spawnSync(
        executable,
        [
          '-NoProfile',
          '-File',
          'scripts/archive-program-releases.ps1',
          '-InstallRoot',
          root,
          '-DeploymentReport',
          report,
          '-Keep',
          '2',
          ...(apply ? ['-Apply'] : []),
        ],
        { encoding: 'utf8', env: environment, windowsHide: true, timeout: 60_000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    try {
      for (const [i, name] of names.entries()) {
        const dir = join(root, name);
        mkdirSync(join(dir, 'server'), { recursive: true });
        mkdirSync(join(dir, 'web'));
        writeFileSync(join(dir, 'server', 'main.mjs'), 'release-' + i);
        writeFileSync(join(dir, 'web', 'index.html'), 'صفحة ' + i);
        utimesSync(dir, 1000 + i, 1000 + i);
      }
      mkdirSync(join(root, 'dist'));
      writeFileSync(join(root, 'dist', 'live.txt'), 'current');
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'active.sqlite'), 'do not touch');
      writeFileSync(report, JSON.stringify({ previousProgramRelease: join(root, names[0]) }));
      assert.equal(run().archived, 2);
      assert.ok(existsSync(join(root, names[1])));
      const applied = run(true);
      assert.equal(applied.archived, 2);
      for (const i of [1, 2]) {
        const zip = unzipSync(readFileSync(join(root, '.program-archive', names[i] + '.zip')));
        assert.equal(strFromU8(zip['server/main.mjs']), 'release-' + i);
        assert.equal(strFromU8(zip['web/index.html']), 'صفحة ' + i);
        assert.equal(existsSync(join(root, names[i])), false);
      }
      for (const i of [0, 3, 4]) assert.ok(existsSync(join(root, names[i])));
      assert.equal(readFileSync(join(root, 'dist', 'live.txt'), 'utf8'), 'current');
      assert.equal(readFileSync(join(root, 'data', 'active.sqlite'), 'utf8'), 'do not touch');
      assert.equal(run(true).archived, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
