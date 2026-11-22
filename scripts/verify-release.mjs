import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import { releaseChecks, RELEASE_PLAN_VERSION } from './release/plan.mjs';
import { sourceIdentity, buildIdentity } from './release/evidence.mjs';
import { runReleaseCheck } from './release/run-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'var/release-verification/latest.json');
mkdirSync(dirname(output), { recursive: true });
const report = {
  format: 1,
  planVersion: RELEASE_PLAN_VERSION,
  status: 'running',
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
};
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
// Invalidate any older success even if the first new check fails.
save();
try {
  report.source = sourceIdentity(root);
  for (const check of releaseChecks) {
    console.log(`\nRelease verification: ${check.id}`);
    const result = { id: check.id, status: 'running', startedAt: new Date().toISOString() };
    report.checks.push(result);
    save();
    await runReleaseCheck(check, root);
    result.status = 'passed';
    result.completedAt = new Date().toISOString();
    save();
  }
  const current = sourceIdentity(root);
  if (JSON.stringify(current) !== JSON.stringify(report.source))
    throw new Error('Source changed during verification. Start again.');
  report.buildHash = buildIdentity(root);
  report.status = 'passed';
  report.completedAt = new Date().toISOString();
  save();
  console.log(`Release checks passed. Report: ${output}`);
  if (current.dirty)
    console.log(
      'Local preview verified. Deployment still requires a clean committed tree and a fresh verification.',
    );
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  report.completedAt = new Date().toISOString();
  save();
  console.error(`Release verification failed: ${error.message}`);
  process.exitCode = 1;
}
