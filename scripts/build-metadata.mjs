import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { APPLICATION_VERSION } from '../src/shared/version.ts';
export function buildMetadata() {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  if (version !== APPLICATION_VERSION) throw new Error('Application and package versions differ');
  let commit = null, dirty = false;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim());
  } catch { /* ZIP builds have no Git provenance. Never invent a commit. */ }
  return { version, commit, dirty, builtAt: new Date().toISOString() };
}
