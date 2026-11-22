import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { RELEASE_PLAN_VERSION, releaseChecks } from './plan.mjs';

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
const digest = (data) => createHash('sha256').update(data).digest('hex');

export function sourceIdentity(root) {
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const paths = [
    ...new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean),
    ),
  ].sort();
  const files = paths.map((path) => {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(resolve(root) + sep)) throw new Error('Source path escaped the workspace');
    let hash;
    try {
      if (!lstatSync(absolute).isFile()) throw new Error(`Not a regular source file: ${path}`);
      hash = digest(readFileSync(absolute));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash = 'deleted';
    }
    return [path, hash];
  });
  return {
    commit,
    dirty: Boolean(git(root, ['status', '--porcelain', '--untracked-files=all']).trim()),
    hash: digest(JSON.stringify(files)),
  };
}

export function buildIdentity(root) {
  const files = [];
  function walk(folder, prefix) {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(folder, entry.name),
        name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, name);
      else if (entry.isFile()) files.push([name, digest(readFileSync(path))]);
      else throw new Error(`Not a regular build file: ${name}`);
    }
  }
  // Mandatory entry points make an empty or incomplete build fail closed.
  readFileSync(join(root, 'dist/server/main.mjs'));
  readFileSync(join(root, 'dist/web/index.html'));
  walk(join(root, 'dist/server'), 'server');
  walk(join(root, 'dist/web'), 'web');
  return digest(JSON.stringify(files));
}

export function assertReleaseEvidence(report, source, buildHash, { requireClean = true } = {}) {
  if (report?.format !== 1 || report.planVersion !== RELEASE_PLAN_VERSION || report.status !== 'passed')
    throw new Error('Release verification is missing or incomplete. Run npm run verify:release.');
  if (requireClean && (source.dirty || report.source?.dirty))
    throw new Error(
      'Commit or resolve local changes, then run npm run verify:release again before deployment.',
    );
  if (report.source?.commit !== source.commit || report.source?.hash !== source.hash)
    throw new Error('Source changed after verification. Run npm run verify:release again.');
  if (report.buildHash !== buildHash)
    throw new Error('Build changed after verification. Run npm run verify:release again.');
  const required = releaseChecks.map((check) => check.id);
  if (
    !Array.isArray(report.checks) ||
    report.checks.length !== required.length ||
    required.some((id, index) => report.checks[index]?.id !== id || report.checks[index]?.status !== 'passed')
  )
    throw new Error('A required release check did not pass.');
  if (!Number.isFinite(Date.parse(report.completedAt)))
    throw new Error('Verification completion time is missing.');
  return report;
}
